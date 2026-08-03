export type MesoscaleArchiveEntry = {
  name: string;
  compressedBytes: number;
  expandedBytes: number;
};

const MAX_ARCHIVE_ENTRIES = 4096;
const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_RATIO = 250;

function readUint16(view: DataView, offset: number) {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error("ZIP metadata is truncated");
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number) {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error("ZIP metadata is truncated");
  return view.getUint32(offset, true);
}

function safePath(name: string) {
  const normalized = name.replace(/\\/gu, "/");
  return normalized.length > 0
    && normalized.length <= 512
    && !normalized.startsWith("/")
    && !/^[a-z]:\//iu.test(normalized)
    && !normalized.split("/").includes("..");
}

export function mesoscaleZipEntries(bytes: Uint8Array): MesoscaleArchiveEntry[] {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Mesoscale package is not a ZIP archive");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = bytes.length - 22;
  while (eocd >= minimumEocd && readUint32(view, eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < minimumEocd) throw new Error("Mesoscale package has no ZIP central directory");
  const entryCount = readUint16(view, eocd + 10);
  const centralSize = readUint32(view, eocd + 12);
  const centralOffset = readUint32(view, eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 mesoscale packages are not supported");
  }
  if (centralOffset + centralSize > bytes.length) throw new Error("Mesoscale ZIP central directory is out of bounds");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries: MesoscaleArchiveEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) throw new Error("Mesoscale ZIP central directory entry is invalid");
    const flags = readUint16(view, offset + 8);
    const compression = readUint16(view, offset + 10);
    const compressedBytes = readUint32(view, offset + 20);
    const expandedBytes = readUint32(view, offset + 24);
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localOffset = readUint32(view, offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw new Error("Mesoscale ZIP central directory name is truncated");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (flags & 0x01) throw new Error(`Encrypted mesoscale package entry is not supported: ${name.slice(0, 160)}`);
    if (flags & 0x08) throw new Error(`ZIP data descriptors are not supported: ${name.slice(0, 160)}`);
    if (compression !== 0 && compression !== 8) throw new Error(`Unsupported ZIP compression method for ${name.slice(0, 160)}`);
    if (readUint32(view, localOffset) !== 0x04034b50) throw new Error(`Mesoscale ZIP local header is invalid: ${name.slice(0, 160)}`);
    const localFlags = readUint16(view, localOffset + 6);
    const localCompression = readUint16(view, localOffset + 8);
    const localCompressedBytes = readUint32(view, localOffset + 18);
    const localExpandedBytes = readUint32(view, localOffset + 22);
    const localNameLength = readUint16(view, localOffset + 26);
    const localExtraLength = readUint16(view, localOffset + 28);
    const localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    const dataEnd = localOffset + 30 + localNameLength + localExtraLength + localCompressedBytes;
    if (localFlags !== flags || localCompression !== compression || localCompressedBytes !== compressedBytes || localExpandedBytes !== expandedBytes || localName !== name || dataEnd > bytes.length) {
      throw new Error(`Mesoscale ZIP local and central metadata disagree: ${name.slice(0, 160)}`);
    }
    entries.push({ name, compressedBytes, expandedBytes });
    offset = next;
  }
  return entries;
}

export function validateMesoscaleArchiveEntries(entries: MesoscaleArchiveEntry[]) {
  if (entries.length === 0 || entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Mesoscale package has ${entries.length} entries; allowed range is 1-${MAX_ARCHIVE_ENTRIES}`);
  }
  const seen = new Set<string>();
  let expandedBytes = 0;
  for (const entry of entries) {
    if (!safePath(entry.name)) throw new Error(`Unsafe mesoscale package path: ${entry.name.slice(0, 160)}`);
    if (seen.has(entry.name)) throw new Error(`Duplicate mesoscale package entry: ${entry.name.slice(0, 160)}`);
    seen.add(entry.name);
    if (/\.(?:zip|molx|mvsx|tar|tgz|7z)$/iu.test(entry.name)) throw new Error(`Nested archive is not allowed: ${entry.name.slice(0, 160)}`);
    if (entry.expandedBytes > MAX_ARCHIVE_ENTRY_BYTES) throw new Error(`Mesoscale package entry is too large: ${entry.name.slice(0, 160)}`);
    if (entry.expandedBytes > 0 && (entry.compressedBytes <= 0 || entry.expandedBytes / entry.compressedBytes > MAX_ARCHIVE_RATIO)) {
      throw new Error(`Mesoscale package compression ratio is unsafe: ${entry.name.slice(0, 160)}`);
    }
    expandedBytes += entry.expandedBytes;
  }
  if (expandedBytes > MAX_ARCHIVE_TOTAL_BYTES) throw new Error("Mesoscale package expands beyond the 2 GiB safety budget");
  const names = entries.map((entry) => entry.name);
  const manifest = names.includes("manifest.json") ? "manifest.json" : names.includes("instanced_structure.json") ? "instanced_structure.json" : null;
  if (!manifest) throw new Error("Mesoscale package is missing manifest.json");
  return { entries: entries.length, expandedBytes, manifest, names };
}

export function validateGenericMesoscaleManifest(manifest: Record<string, any>, availableNames: Set<string>) {
  if (!Array.isArray(manifest.roots) || manifest.roots.length === 0) throw new Error("Mesoscale manifest must declare at least one root");
  if (!Array.isArray(manifest.entities) || manifest.entities.length === 0 || manifest.entities.length > 100_000) {
    throw new Error("Mesoscale manifest must declare 1-100000 entities");
  }
  for (const entity of manifest.entities) {
    if (typeof entity?.file !== "string" || !safePath(entity.file) || !availableNames.has(entity.file)) {
      throw new Error(`Mesoscale manifest references a missing or unsafe asset: ${String(entity?.file || "").slice(0, 160)}`);
    }
    if (!Array.isArray(entity.groups) || entity.groups.length === 0) throw new Error(`Mesoscale entity has no group: ${entity.file}`);
    const positions = entity.instances?.positions?.data;
    const rotations = entity.instances?.rotations?.data;
    if (Array.isArray(positions) && (!positions.every(Number.isFinite) || positions.length % 3 !== 0)) {
      throw new Error(`Mesoscale positions are invalid: ${entity.file}`);
    }
    if (Array.isArray(rotations)) {
      const width = entity.instances?.rotations?.variant === "matrix" ? 9 : entity.instances?.rotations?.variant === "quaternion" ? 4 : 3;
      if (!rotations.every(Number.isFinite) || rotations.length % width !== 0 || Array.isArray(positions) && positions.length / 3 !== rotations.length / width) {
        throw new Error(`Mesoscale rotations are invalid: ${entity.file}`);
      }
    }
  }
}
