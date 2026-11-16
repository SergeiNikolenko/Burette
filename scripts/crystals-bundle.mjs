#!/usr/bin/env node
// Offline-only source verification and deterministic Crystals data packaging.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, fstatSync, readSync, closeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { gzipSync } = require('fflate');
const compressor = `fflate-${require('fflate/package.json').version}-gzip-level9-mtime0`;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Crystals bundle: ${message}`); };
const json = value => Buffer.from(`${JSON.stringify(value)}\n`);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readBounded(path, limit) {
  const file = openSync(path, 'r');
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size > limit) fail('input file exceeds bound.');
    const bytes = Buffer.alloc(limit + 1);
    let length = 0, count;
    while (length < bytes.length && (count = readSync(file, bytes, length, bytes.length - length, null))) length += count;
    if (length > limit) fail('input file exceeds bound.');
    return bytes.subarray(0, length);
  } finally { closeSync(file); }
}

function zipEntries(bytes, lock) {
  const { limits, source } = lock;
  if (bytes.length > limits.archiveBytes || bytes.length !== source.archiveBytes || sha256(bytes) !== source.archiveSha256) fail('source archive size/hash mismatch.');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && (bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end--;
  if (end < Math.max(0, bytes.length - 65557)) fail('truncated ZIP directory.');
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt32LE(end + 4) || bytes.readUInt16LE(end + 8) !== count || count > limits.entries || start + bytes.readUInt32LE(end + 12) !== end) fail('unsupported or oversized ZIP directory.');
  const names = new Set(), entries = [];
  let offset = start, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) fail('invalid ZIP entry.');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16), size = bytes.readUInt32LE(offset + 20), originalSize = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28), extraSize = bytes.readUInt16LE(offset + 30), commentSize = bytes.readUInt16LE(offset + 32);
    const next = offset + 46 + nameSize + extraSize + commentSize, local = bytes.readUInt32LE(offset + 42);
    if (next > end || bytes.readUInt16LE(offset + 34) || flags & 1 || ![0, 8].includes(method)) fail('unsupported ZIP entry.');
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameSize);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    const parts = name.replace(/\/$/u, '').split('/');
    if (!name.startsWith(source.prefix) || name.length > 256 || /[\\:\p{Cc}\p{Cf}]/u.test(name) || parts.some(part => !part || part === '.' || part === '..')) fail('unsafe ZIP path.');
    if (names.has(name)) fail('duplicate ZIP path.');
    names.add(name);
    const mode = (bytes.readUInt32LE(offset + 38) >>> 16) & 0xf000;
    if (![0, 0x4000, 0x8000].includes(mode) || (mode === 0x4000 && !name.endsWith('/'))) fail('ZIP links/special files are forbidden.');
    expanded += originalSize;
    if (expanded > limits.expandedBytes) fail('expanded archive exceeds bound.');
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) fail('invalid ZIP local header.');
    const localNameSize = bytes.readUInt16LE(local + 26), data = local + 30 + localNameSize + bytes.readUInt16LE(local + 28);
    if (!nameBytes.equals(bytes.subarray(local + 30, local + 30 + localNameSize)) || data + size > start) fail('truncated or mismatched ZIP entry.');
    entries.push({ path: name.slice(source.prefix.length), local, data, size, originalSize, crc, method });
    offset = next;
  }
  if (offset !== end) fail('unexpected ZIP directory data.');
  const ranges = [...entries].sort((a, b) => a.local - b.local);
  if (ranges.some((entry, i) => i && entry.local < ranges[i - 1].data + ranges[i - 1].size)) fail('overlapping ZIP entries.');
  return entries;
}

/** Input is authenticated before extraction; only CIF and attribution data survive. */
export function buildCrystalsBundle(input, lock) {
  const bytes = Buffer.from(input), entries = zipEntries(bytes, lock), files = [];
  let retainedBytes = 0, cifCount = 0, cifBytes = 0;
  for (const entry of entries) {
    const cif = entry.path.endsWith('.cif');
    if (!cif && !['README.md', 'plugin.json'].includes(entry.path)) continue;
    if (!entry.originalSize || entry.originalSize > lock.limits.cifBytes) fail('retained file exceeds bound.');
    retainedBytes += entry.originalSize;
    if (retainedBytes > lock.limits.retainedBytes) fail('retained corpus exceeds bound.');
    const compressed = bytes.subarray(entry.data, entry.data + entry.size);
    const content = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: entry.originalSize });
    if (content.length !== entry.originalSize || crc32(content) !== entry.crc) fail('ZIP content size/checksum mismatch.');
    if (cif) { cifCount++; cifBytes += content.length; }
    files.push({ path: entry.path, bytes: content.length, sha256: sha256(content), dataBase64: content.toString('base64') });
  }
  if (cifCount !== lock.corpus.cifCount || cifBytes !== lock.corpus.cifBytes || !files.some(file => file.path === 'README.md') || !files.some(file => file.path === 'plugin.json')) fail('unexpected CIF corpus or missing attribution.');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const document = { schemaVersion: 1, id: lock.id, source: lock.source, files };
  return { document, bytes: Buffer.from(gzipSync(json(document), { level: 9, mtime: 0 })), compressor };
}

function verifyDistribution(bytes, lock) {
  if (bytes.length !== lock.bundle.bytes || sha256(bytes) !== lock.bundle.sha256) fail('distribution bundle size/hash mismatch.');
  const text = gunzipSync(bytes, { maxOutputLength: lock.limits.retainedBytes * 2 });
  const document = JSON.parse(text.toString('utf8'));
  if (document.schemaVersion !== 1 || document.id !== lock.id || JSON.stringify(document.source) !== JSON.stringify(lock.source)) fail('distribution identity mismatch.');
  let cifCount = 0, cifBytes = 0;
  const seen = new Set();
  for (const file of document.files) {
    const content = Buffer.from(file.dataBase64, 'base64');
    if (seen.has(file.path) || content.length !== file.bytes || sha256(content) !== file.sha256) fail('distribution file mismatch.');
    seen.add(file.path);
    if (file.path.endsWith('.cif')) { cifCount++; cifBytes += content.length; }
  }
  if (cifCount !== lock.corpus.cifCount || cifBytes !== lock.corpus.cifBytes || !seen.has('README.md') || !seen.has('plugin.json')) fail('distribution corpus mismatch.');
  return { cifCount, cifBytes, bundleBytes: bytes.length, sha256: sha256(bytes) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), archiveIndex = args.indexOf('--archive');
    if (args.some((arg, i) => !['--check', '--write', '--archive'].includes(arg) && (archiveIndex < 0 || i !== archiveIndex + 1)) || (args.includes('--write') && args.includes('--check')) || (archiveIndex >= 0 && !args[archiveIndex + 1])) fail('usage: crystals-bundle.mjs [--check | --write] [--archive <local.zip>]');
    const lock = JSON.parse(readFileSync(resolve(root, 'config/crystals-resource.lock.json'), 'utf8'));
    const output = resolve(root, lock.bundle.path);
    if (args.includes('--write') && archiveIndex < 0) fail('--write requires an explicit local --archive; network fetching is never automatic.');
    if (archiveIndex >= 0) {
      const built = buildCrystalsBundle(readBounded(args[archiveIndex + 1], lock.source.archiveBytes), lock);
      verifyDistribution(built.bytes, lock);
      if (built.compressor !== lock.bundle.compressor) fail('compression toolchain differs from lock.');
      if (args.includes('--write')) {
        const temporary = `${output}.${randomUUID()}.tmp`;
        try {
          const file = openSync(temporary, 'wx', 0o644);
          try { writeFileSync(file, built.bytes); fsyncSync(file); }
          finally { closeSync(file); }
          renameSync(temporary, output);
        } catch (error) {
          try { unlinkSync(temporary); } catch { /* Keep the publication error. */ }
          throw error;
        }
      }
      else if (!built.bytes.equals(readBounded(output, lock.bundle.bytes))) fail('offline regeneration differs from retained distribution.');
    }
    console.log(JSON.stringify({ ok: true, ...verifyDistribution(readBounded(output, lock.bundle.bytes), lock) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
