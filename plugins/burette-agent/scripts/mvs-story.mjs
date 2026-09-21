import { existsSync } from 'node:fs';
import { mkdir, open as openFile, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { validateOfficialMvs } from './mvs-schema-validator.mjs';

const MAX_STEPS = 256;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1024;
const MAX_ARCHIVE_PATH_BYTES = 4096;
const MAX_COMPRESSION_RATIO = 1000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function buildMvsStory(spec, { now = new Date() } = {}) {
  if (isObject(spec) && spec.kind === 'multiple') return normalizeStory(spec, { now });
  const title = boundedRequiredString(spec?.title, 'Story title', 512);
  const description = boundedOptionalString(spec?.description, 16_384);
  const snapshots = Array.isArray(spec?.snapshots) ? spec.snapshots : Array.isArray(spec?.steps) ? spec.steps : [];
  if (snapshots.length === 0) throw storyError('STORY_EMPTY', 'MolViewSpec Story requires at least one snapshot.');
  return normalizeStory({
    kind: 'multiple',
    metadata: {
      title,
      ...(description ? { description } : {}),
      ...(spec?.description_format === 'plaintext' ? { description_format: 'plaintext' } : {}),
      timestamp: now.toISOString(),
      version: '1.0',
    },
    snapshots: snapshots.map((snapshot, index) => ({
      root: snapshot?.root ?? snapshot?.scene?.root ?? snapshot?.scene,
      metadata: {
        key: snapshot?.metadata?.key ?? snapshot?.key ?? `step-${index + 1}`,
        title: snapshot?.metadata?.title ?? snapshot?.title ?? `Step ${index + 1}`,
        description: snapshot?.metadata?.description ?? snapshot?.description ?? '',
        description_format: snapshot?.metadata?.description_format ?? snapshot?.description_format ?? 'markdown',
        linger_duration_ms: snapshot?.metadata?.linger_duration_ms ?? snapshot?.linger_duration_ms ?? snapshot?.lingerDurationMs ?? 8000,
        transition_duration_ms: snapshot?.metadata?.transition_duration_ms ?? snapshot?.transition_duration_ms ?? snapshot?.transitionDurationMs ?? 1000,
      },
      ...(snapshot?.animation ? { animation: snapshot.animation } : {}),
    })),
  }, { now });
}

export function validateMvsStory(input, { resourceNames = null, requireBundledResources = false, disallowRelativeResources = false } = {}) {
  const issues = [];
  const warnings = [];
  let story;
  try {
    story = normalizeStory(input);
  } catch (error) {
    return { ok: false, issues: [storyIssue(error?.code || 'INVALID_STORY', error?.message || String(error))], warnings, summary: null, story: null };
  }
  const documentValidation = validateMvsDocument(story, { resourceNames, requireBundledResources, disallowRelativeResources });
  issues.push(...documentValidation.issues);
  warnings.push(...documentValidation.warnings);
  const resources = documentValidation.resources;
  return {
    ok: issues.length === 0,
    issues,
    warnings,
    summary: storySummary(story, resources),
    story,
  };
}

export function validateMvsDocument(input, { resourceNames = null, requireBundledResources = false, disallowRelativeResources = false } = {}) {
  const issues = validateOfficialMvs(input).map(message => storyIssue('MVS_SCHEMA_INVALID', message));
  const warnings = [];
  const resources = collectMvsResources(input);
  const available = resourceNames ? new Set(resourceNames.map(normalizeArchivePath)) : null;
  for (const resource of resources) {
    if (resource.length > 4096) {
      issues.push(storyIssue('RESOURCE_URL_TOO_LONG', 'Story resource URL exceeds 4096 characters.'));
      continue;
    }
    if (isAllowedExternalResource(resource)) continue;
    if (hasResourceScheme(resource) || resource.startsWith('/')) {
      issues.push(storyIssue('UNSAFE_RESOURCE_URL', `Story resource URL is not allowed: ${boundedResourceLabel(resource)}`));
      continue;
    }
    if (unsafeArchivePath(resource)) {
      issues.push(storyIssue('UNSAFE_RESOURCE_PATH', `Story resource path is unsafe: ${boundedResourceLabel(resource)}`, { resource: boundedResourceLabel(resource) }));
    } else if (disallowRelativeResources) {
      issues.push(storyIssue('RELATIVE_RESOURCE_REQUIRES_MVSX', `Relative Story resources require MVSX packaging: ${resource}`, { resource }));
    } else if (available && !available.has(normalizeArchivePath(resource))) {
      const issue = storyIssue('MISSING_RESOURCE', `Story resource is not present in the bundle: ${resource}`, { resource });
      if (requireBundledResources) issues.push(issue);
      else warnings.push(issue);
    }
  }
  return { ok: issues.length === 0, issues, warnings, resources, story: input };
}

export async function readMvsStoryFile(filePath) {
  const path = resolve(filePath);
  const extension = extname(path).toLowerCase();
  const bytes = await readBoundedFile(path, MAX_BUNDLE_BYTES);
  if (extension === '.mvsj') {
    if (bytes.length > MAX_JSON_BYTES) throw storyError('STORY_TOO_LARGE', `MVSJ exceeds ${MAX_JSON_BYTES} bytes.`);
    return { path, format: 'mvsj', resourceNames: [], story: JSON.parse(textDecoder.decode(bytes)) };
  }
  if (extension !== '.mvsx') throw storyError('UNSUPPORTED_FORMAT', 'Story file must use .mvsj or .mvsx.');
  const entries = unzipEntries(bytes);
  const index = entries.get('index.mvsj');
  if (!index) throw storyError('MISSING_INDEX', 'MVSX archive does not contain index.mvsj.');
  if (index.length > MAX_JSON_BYTES) throw storyError('STORY_TOO_LARGE', `MVSX index.mvsj exceeds ${MAX_JSON_BYTES} bytes.`);
  return {
    path,
    format: 'mvsx',
    resourceNames: [...entries.keys()].filter(name => name !== 'index.mvsj'),
    story: JSON.parse(textDecoder.decode(index)),
  };
}

export async function validateMvsStoryFile(filePath) {
  try {
    const loaded = await readMvsStoryFile(filePath);
    const validation = validateMvsStory(loaded.story, {
      resourceNames: loaded.resourceNames,
      requireBundledResources: loaded.format === 'mvsx',
      disallowRelativeResources: loaded.format === 'mvsj',
    });
    return { ...validation, path: loaded.path, format: loaded.format, resourceNames: loaded.resourceNames };
  } catch (error) {
    return {
      ok: false,
      path: resolve(filePath),
      format: extname(filePath).toLowerCase().slice(1) || null,
      resourceNames: [],
      story: null,
      summary: null,
      warnings: [],
      issues: [storyIssue(error?.code || 'INVALID_STORY_FILE', error?.message || String(error))],
    };
  }
}

export async function validateMvsDocumentFile(filePath) {
  try {
    const loaded = await readMvsStoryFile(filePath);
    const validation = validateMvsDocument(loaded.story, {
      resourceNames: loaded.resourceNames,
      requireBundledResources: loaded.format === 'mvsx',
      disallowRelativeResources: loaded.format === 'mvsj',
    });
    return {
      ...validation,
      summary: loaded.story?.kind === 'multiple'
        ? storySummary(loaded.story, validation.resources)
        : { kind: loaded.story?.kind || null, resourceCount: validation.resources.length, resources: validation.resources.slice(0, 50).map(resource => boundedResourceLabel(resource, 512)), resourcesTruncated: validation.resources.length > 50 },
      path: loaded.path,
      format: loaded.format,
      resourceNames: loaded.resourceNames,
    };
  } catch (error) {
    return {
      ok: false,
      path: resolve(filePath),
      format: extname(filePath).toLowerCase().slice(1) || null,
      resourceNames: [],
      story: null,
      summary: null,
      warnings: [],
      issues: [storyIssue(error?.code || 'INVALID_MVS_FILE', error?.message || String(error))],
      resources: [],
    };
  }
}

export async function writeMvsStoryFile({ story: input, outputPath, assets = {}, overwrite = false }) {
  const story = buildMvsStory(input);
  const path = resolve(outputPath);
  const extension = extname(path).toLowerCase();
  if (!['.mvsj', '.mvsx'].includes(extension)) throw storyError('UNSUPPORTED_FORMAT', 'Story output must use .mvsj or .mvsx.');
  if (!overwrite && existsSync(path)) throw storyError('OUTPUT_EXISTS', `Refusing to overwrite existing Story file: ${path}`);
  const assetEntries = new Map();
  const canonicalAssetPaths = new Set();
  let assetBytes = 0;
  const assetMappings = Object.entries(assets || {});
  if (extension === '.mvsj' && assetMappings.length > 0) throw storyError('ASSETS_REQUIRE_MVSX', 'Story assets can only be packaged in an .mvsx output.');
  if (assetMappings.length >= MAX_ARCHIVE_ENTRIES) throw storyError('TOO_MANY_ENTRIES', `MVSX supports at most ${MAX_ARCHIVE_ENTRIES - 1} asset entries plus index.mvsj.`);
  for (const [archivePath, sourcePath] of assetMappings) {
    assertSafeArchivePath(archivePath);
    if (normalizeArchivePath(archivePath) === 'index.mvsj') throw storyError('UNSAFE_RESOURCE_PATH', 'MVSX assets cannot replace index.mvsj.');
    const canonicalPath = normalizeArchivePath(archivePath);
    if (canonicalAssetPaths.has(canonicalPath)) throw storyError('DUPLICATE_ENTRY', `Duplicate MVSX asset path: ${archivePath}`);
    canonicalAssetPaths.add(canonicalPath);
    const bytes = await readBoundedFile(resolve(sourcePath), MAX_ASSET_BYTES);
    assetBytes += bytes.length;
    if (assetBytes > MAX_BUNDLE_BYTES) throw storyError('BUNDLE_TOO_LARGE', `MVSX assets exceed ${MAX_BUNDLE_BYTES} bytes.`);
    assetEntries.set(canonicalPath, bytes);
  }
  validateBundledJsonResources(story, assetEntries);
  const validation = validateMvsStory(story, {
    resourceNames: [...assetEntries.keys()],
    requireBundledResources: extension === '.mvsx',
    disallowRelativeResources: extension === '.mvsj',
  });
  if (!validation.ok) {
    const issues = validation.issues.slice(0, 50);
    throw storyError('INVALID_STORY', issues.map(issue => issue.message).join('; ').slice(0, 16_384), {
      issues,
      total: validation.issues.length,
      truncated: validation.issues.length > issues.length,
    });
  }
  const json = `${JSON.stringify(story, null, 2)}\n`;
  const jsonBytes = textEncoder.encode(json);
  if (jsonBytes.length > MAX_JSON_BYTES) throw storyError('STORY_TOO_LARGE', `Story JSON exceeds ${MAX_JSON_BYTES} bytes.`);
  if (jsonBytes.length + assetBytes > MAX_BUNDLE_BYTES) throw storyError('BUNDLE_TOO_LARGE', `Expanded MVSX exceeds ${MAX_BUNDLE_BYTES} bytes.`);
  await mkdir(dirname(path), { recursive: true });
  if (extension === '.mvsj') {
    await writeFile(path, json, { flag: overwrite ? 'w' : 'wx' });
    return { ok: true, path, format: 'mvsj', byteCount: jsonBytes.length, summary: validation.summary, warnings: validation.warnings };
  } else {
    const archive = zipStored(new Map([['index.mvsj', jsonBytes], ...assetEntries]));
    if (archive.length > MAX_BUNDLE_BYTES) throw storyError('BUNDLE_TOO_LARGE', `MVSX archive exceeds ${MAX_BUNDLE_BYTES} bytes.`);
    unzipEntries(archive);
    await writeFile(path, archive, { flag: overwrite ? 'w' : 'wx' });
    return { ok: true, path, format: 'mvsx', byteCount: archive.length, summary: validation.summary, warnings: validation.warnings };
  }
}

function validateBundledJsonResources(story, assetEntries) {
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isObject(value)) return;
    if (value.kind === 'primitives_from_uri' && typeof value.params?.uri === 'string') {
      const uri = value.params.uri.trim();
      if (!isAllowedExternalResource(uri) && !hasResourceScheme(uri) && !uri.startsWith('/') && !unsafeArchivePath(uri)) {
        const resource = normalizeArchivePath(uri);
        const primitives = parseBundledJsonResource(assetEntries, resource, 'INVALID_PRIMITIVE_RESOURCE', 'primitive');
        if (primitives) {
          const hasPrimitive = primitives?.kind === 'primitives'
            && Array.isArray(primitives.children)
            && primitives.children.some(child => child?.kind === 'primitive');
          if (!hasPrimitive) {
            throw storyError('INVALID_PRIMITIVE_RESOURCE', `MVS primitive resource must contain at least one visible primitive: ${resource}`, { resource });
          }
        }
      }
    }
    if (value.kind === 'component_from_uri' && value.params?.format === 'json' && typeof value.params.uri === 'string') {
      const uri = value.params.uri.trim();
      if (!isAllowedExternalResource(uri) && !hasResourceScheme(uri) && !uri.startsWith('/') && !unsafeArchivePath(uri)) {
        const resource = normalizeArchivePath(uri);
        const rows = parseBundledJsonResource(assetEntries, resource, 'INVALID_ANNOTATION_RESOURCE', 'annotation');
        if (rows) {
          if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isObject)) {
            throw storyError('INVALID_ANNOTATION_RESOURCE', `MVS annotation resource must contain at least one selector row: ${resource}`, { resource });
          }
        }
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(story);
}

function parseBundledJsonResource(assetEntries, resource, code, label) {
  const bytes = assetEntries.get(resource);
  if (!bytes) return null;
  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch (_) {
    throw storyError(code, `MVS ${label} resource is not valid JSON: ${resource}`, { resource });
  }
}

function normalizeStory(input, { now = new Date() } = {}) {
  if (!isObject(input)) throw storyError('INVALID_STORY', 'MolViewSpec Story must be an object.');
  if (input.kind !== 'multiple') throw storyError('INVALID_KIND', 'MolViewSpec Story must use kind: "multiple".');
  if (!Array.isArray(input.snapshots) || input.snapshots.length === 0) throw storyError('STORY_EMPTY', 'MolViewSpec Story requires at least one snapshot.');
  if (input.snapshots.length > MAX_STEPS) throw storyError('TOO_MANY_STEPS', `MolViewSpec Story supports at most ${MAX_STEPS} snapshots.`);
  const keys = new Set();
  const snapshots = input.snapshots.map((snapshot, index) => {
    if (!isObject(snapshot?.root) || snapshot.root.kind !== 'root') throw storyError('INVALID_ROOT', `Snapshot ${index + 1} must contain root.kind = "root".`);
    const metadata = isObject(snapshot.metadata) ? snapshot.metadata : {};
    const key = boundedRequiredString(metadata.key ?? `step-${index + 1}`, `Snapshot ${index + 1} key`, 256);
    if (keys.has(key)) throw storyError('DUPLICATE_KEY', `Snapshot key is duplicated: ${key}`);
    keys.add(key);
    return {
      root: snapshot.root,
      metadata: {
        key,
        title: boundedRequiredString(metadata.title ?? `Step ${index + 1}`, `Snapshot ${index + 1} title`, 512),
        description: boundedOptionalString(metadata.description, 64 * 1024),
        description_format: metadata.description_format === 'plaintext' ? 'plaintext' : 'markdown',
        linger_duration_ms: boundedDuration(metadata.linger_duration_ms, 8000),
        transition_duration_ms: boundedDuration(metadata.transition_duration_ms, 1000),
      },
      ...(snapshot.animation ? { animation: snapshot.animation } : {}),
    };
  });
  const metadata = isObject(input.metadata) ? input.metadata : {};
  const description = boundedOptionalString(metadata.description, 64 * 1024);
  return {
    kind: 'multiple',
    metadata: {
      title: boundedRequiredString(metadata.title ?? 'Molecular Story', 'Story title', 512),
      ...(description ? { description } : {}),
      ...(metadata.description_format === 'plaintext' ? { description_format: 'plaintext' } : {}),
      timestamp: typeof metadata.timestamp === 'string' && metadata.timestamp.trim() ? metadata.timestamp.trim() : now.toISOString(),
      version: typeof metadata.version === 'string' && metadata.version.trim() ? metadata.version.trim() : '1.0',
    },
    snapshots,
  };
}

function collectMvsResources(document) {
  const resources = new Set();
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isObject(value)) return;
    if (typeof value.params?.url === 'string') resources.add(value.params.url.trim());
    if (typeof value.params?.uri === 'string') resources.add(value.params.uri.trim());
    Object.values(value).forEach(visit);
  };
  visit(document);
  return [...resources].filter(Boolean);
}

function storySummary(story, resources) {
  return {
    title: story.metadata.title,
    stepCount: story.snapshots.length,
    steps: story.snapshots.map((snapshot, index) => ({ index, key: snapshot.metadata.key, title: snapshot.metadata.title, descriptionFormat: snapshot.metadata.description_format })),
    resourceCount: resources.length,
    resources: resources.slice(0, 50).map(resource => boundedResourceLabel(resource, 512)),
    resourcesTruncated: resources.length > 50,
  };
}

function zipStored(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const nameBytes = textEncoder.encode(name);
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length + data.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    Buffer.from(nameBytes).copy(local, 30); Buffer.from(data).copy(local, 30 + nameBytes.length); locals.push(local);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    Buffer.from(nameBytes).copy(central, 46); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function unzipEntries(bytes) {
  const buffer = Buffer.from(bytes);
  const end = findSignature(buffer, 0x06054b50, Math.max(0, buffer.length - 65_557));
  if (end < 0) throw storyError('INVALID_ARCHIVE', 'MVSX central directory was not found.');
  const count = buffer.readUInt16LE(end + 10);
  if (count > MAX_ARCHIVE_ENTRIES) throw storyError('TOO_MANY_ENTRIES', `MVSX contains more than ${MAX_ARCHIVE_ENTRIES} archive entries.`);
  let cursor = buffer.readUInt32LE(end + 16);
  const output = new Map();
  const canonicalPaths = new Set();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw storyError('INVALID_ARCHIVE', 'Invalid MVSX central directory entry.');
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assertSafeArchivePath(name);
    const canonicalPath = normalizeArchivePath(name);
    if (canonicalPaths.has(canonicalPath)) throw storyError('DUPLICATE_ENTRY', `Duplicate path in MVSX archive: ${name}`);
    canonicalPaths.add(canonicalPath);
    const entryLimit = canonicalPath === 'index.mvsj' ? MAX_JSON_BYTES : MAX_ASSET_BYTES;
    if (size > entryLimit) throw storyError('ARCHIVE_ENTRY_TOO_LARGE', `Expanded MVSX entry exceeds ${entryLimit} bytes: ${name}`);
    if (size > MAX_BUNDLE_BYTES - total) throw storyError('BUNDLE_TOO_LARGE', `Expanded MVSX exceeds ${MAX_BUNDLE_BYTES} bytes.`);
    if (method === 8 && size > 0 && (compressedSize === 0 || size / compressedSize > MAX_COMPRESSION_RATIO)) {
      throw storyError('SUSPICIOUS_COMPRESSION_RATIO', `MVSX entry has an unsafe compression ratio: ${name}`);
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw storyError('INVALID_ARCHIVE', `Invalid local entry for ${name}.`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start > buffer.length || compressedSize > buffer.length - start) throw storyError('INVALID_ARCHIVE', `Truncated MVSX entry: ${name}`);
    const compressed = buffer.subarray(start, start + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed, { maxOutputLength: entryLimit }) : null;
    if (!data || data.length !== size) throw storyError('INVALID_ARCHIVE', `Unsupported or corrupt MVSX entry: ${name}`);
    if (crc32(data) !== expectedCrc) throw storyError('INVALID_ARCHIVE', `CRC mismatch for MVSX entry: ${name}`);
    total += data.length;
    if (total > MAX_BUNDLE_BYTES) throw storyError('BUNDLE_TOO_LARGE', `Expanded MVSX exceeds ${MAX_BUNDLE_BYTES} bytes.`);
    output.set(canonicalPath, new Uint8Array(data));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}

function findSignature(buffer, signature, minimum) {
  for (let index = buffer.length - 22; index >= minimum; index -= 1) if (buffer.readUInt32LE(index) === signature) return index;
  return -1;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readBoundedFile(path, limit) {
  const handle = await openFile(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw storyError('INVALID_RESOURCE_FILE', `${basename(path)} is not a regular file.`);
    if (info.size > limit) throw storyError('FILE_TOO_LARGE', `${basename(path)} exceeds ${limit} bytes.`);
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    const { bytesRead: extraBytesRead } = await handle.read(extra, 0, 1, offset);
    if (extraBytesRead > 0) throw storyError('FILE_TOO_LARGE', `${basename(path)} exceeds ${limit} bytes.`);
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function boundedDuration(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0 || number > 3_600_000) throw storyError('INVALID_DURATION', 'Story durations must be between 0 and 3600000 ms.');
  return Math.round(number);
}

function boundedRequiredString(value, label, limit) {
  const string = typeof value === 'string' ? value.trim() : '';
  if (!string) throw storyError('INVALID_TEXT', `${label} is required.`);
  if (string.length > limit) throw storyError('INVALID_TEXT', `${label} exceeds ${limit} characters.`);
  return string;
}

function boundedOptionalString(value, limit) {
  const string = typeof value === 'string' ? value.trim() : '';
  if (string.length > limit) throw storyError('INVALID_TEXT', `Story text exceeds ${limit} characters.`);
  return string;
}

function hasResourceScheme(value) { return /^[a-z][a-z0-9+.-]*:/iu.test(value); }
function isAllowedExternalResource(value) { return /^(?:https?|data):/iu.test(value); }
function normalizeArchivePath(value) {
  let normalized = String(value || '').trim();
  try {
    for (let pass = 0; pass < 4; pass += 1) {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = decoded;
    }
  } catch (_) {
    return '';
  }
  return normalized.normalize('NFC').replace(/^(?:\.\/)+/u, '');
}
function unsafeArchivePath(value) {
  const normalized = normalizeArchivePath(value);
  return !normalized
    || normalized.startsWith('/')
    || hasResourceScheme(normalized)
    || normalized.includes('\\')
    || normalized.includes('?')
    || normalized.includes('#')
    || /[\u0000-\u001f\u007f]/u.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..');
}
function assertSafeArchivePath(value) {
  if (unsafeArchivePath(value)) throw storyError('UNSAFE_RESOURCE_PATH', `Unsafe path in MVSX archive: ${boundedResourceLabel(value)}`);
  if (textEncoder.encode(normalizeArchivePath(value)).length > MAX_ARCHIVE_PATH_BYTES) {
    throw storyError('RESOURCE_PATH_TOO_LONG', `MVSX archive path exceeds ${MAX_ARCHIVE_PATH_BYTES} bytes.`);
  }
}
function boundedResourceLabel(value, limit = 2048) {
  const string = String(value || '');
  if (string.startsWith('data:')) return `[data URL: ${string.length} characters]`;
  return string.length > limit ? `${string.slice(0, limit)}…` : string;
}
function isObject(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function storyIssue(code, message, details = null) { return { code, message, ...(details ? { details } : {}) }; }
function storyError(code, message, details = null) { const error = new Error(message); error.code = code; error.details = details; return error; }
