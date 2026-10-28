import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { buildCrystalsBundle, sha256 } from '../scripts/crystals-bundle.mjs';

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { zipSync } = require('fflate');
const productionLock = JSON.parse(readFileSync(new URL('../config/crystals-resource.lock.json', import.meta.url), 'utf8'));
const prefix = productionLock.source.prefix;
const cif = Buffer.from('data_reference\r\n# Original citation: Ångström\r\n_cell_length_a 5.0(1)\r\n');
const files = () => ({ [`${prefix}a.cif`]: cif, [`${prefix}b.cif`]: cif,
  [`${prefix}README.md`]: Buffer.from('Fixture public-domain attribution\n'),
  [`${prefix}plugin.json`]: Buffer.from('{"type":"data","author":"Fixture"}\n'),
  [`${prefix}preview.png`]: Buffer.from([1, 2, 3]) });
const archive = (entries = files()) => Buffer.from(zipSync(entries, { level: 0, mtime: new Date('2020-01-01T00:00:00Z') }));
const lockFor = (bytes: Buffer) => ({ ...productionLock, source: { ...productionLock.source, archiveBytes: bytes.length, archiveSha256: sha256(bytes) }, corpus: { cifCount: 2, cifBytes: 2 * cif.length } });
const build = (bytes: Buffer) => buildCrystalsBundle(bytes, lockFor(bytes));
function replaceNames(bytes: Buffer, from: string, to: string) {
  const result = Buffer.from(bytes);
  for (let at = result.indexOf(from); at >= 0; at = result.indexOf(from, at + to.length)) result.write(to, at);
  return result;
}

test('offline bundle preserves exact CIF/attribution bytes, drops previews and is deterministic', () => {
  const bytes = archive(), first = build(bytes), second = build(bytes);
  expect(first.bytes).toEqual(second.bytes);
  const document = JSON.parse(gunzipSync(first.bytes).toString());
  expect(document.files.map((file: { path: string }) => file.path)).toEqual(['README.md', 'a.cif', 'b.cif', 'plugin.json']);
  for (const file of document.files) {
    const original = files()[`${prefix}${file.path}` as keyof ReturnType<typeof files>];
    expect(Buffer.from(file.dataBase64, 'base64')).toEqual(original);
    expect(file.sha256).toBe(sha256(original));
  }
  // File payload order is canonical; changed archive identity remains explicit.
  const reordered = archive(Object.fromEntries(Object.entries(files()).reverse()));
  expect(build(reordered).document.files).toEqual(document.files);
});

test('unauthenticated, truncated and corrupt ZIP inputs fail before producing a bundle', () => {
  const bytes = archive(), corrupt = Buffer.from(bytes);
  corrupt[corrupt.indexOf(cif)] ^= 1;
  expect(() => buildCrystalsBundle(corrupt, lockFor(bytes))).toThrow('size/hash');
  expect(() => build(bytes.subarray(0, bytes.length - 8))).toThrow('truncated');
  expect(() => build(corrupt)).toThrow('checksum');
});

test('path escapes, links and duplicate names are rejected across all archive entries', () => {
  for (const path of ['../escape.cif', '/absolute.cif', 'nested/../escape.cif', 'nested\\escape.cif', 'C:escape.cif']) {
    expect(() => build(archive({ ...files(), [`${prefix}${path}`]: cif }))).toThrow('unsafe ZIP path');
  }
  const symlink = archive({ ...files(), [`${prefix}link.png`]: [cif, { os: 3, attrs: 0xa1ff0000 }] } as ReturnType<typeof files>);
  expect(() => build(symlink)).toThrow('links/special');
  expect(() => build(replaceNames(archive(), `${prefix}b.cif`, `${prefix}a.cif`))).toThrow('duplicate');
});

test('entry, expansion, file, retained-corpus and exact record-count bounds fail atomically', () => {
  const bytes = archive(), lock = lockFor(bytes);
  for (const [field, value] of [['entries', 1], ['expandedBytes', 1], ['retainedBytes', 1], ['archiveBytes', bytes.length - 1]]) {
    expect(() => buildCrystalsBundle(bytes, { ...lock, limits: { ...lock.limits, [field]: value } })).toThrow();
  }
  expect(() => build(archive({ ...files(), [`${prefix}a.cif`]: Buffer.alloc(productionLock.limits.cifBytes + 1) }))).toThrow('retained file exceeds');
  const missing = files(); delete missing[`${prefix}b.cif`];
  expect(() => build(archive(missing))).toThrow('unexpected CIF corpus');
  const noAttribution = files(); delete noAttribution[`${prefix}README.md`];
  expect(() => build(archive(noAttribution))).toThrow('missing attribution');
});

test('retained real distribution matches its lock and independently hashes every file', () => {
  const bytes = readFileSync(new URL(`../${productionLock.bundle.path}`, import.meta.url));
  expect({ bytes: bytes.length, sha256: sha256(bytes) }).toEqual({ bytes: productionLock.bundle.bytes, sha256: productionLock.bundle.sha256 });
  const document = JSON.parse(gunzipSync(bytes).toString());
  const cifs = document.files.filter((file: { path: string }) => file.path.endsWith('.cif'));
  expect({ count: cifs.length, bytes: cifs.reduce((sum: number, file: { bytes: number }) => sum + file.bytes, 0) }).toEqual({ count: 524, bytes: 1429884 });
  for (const file of document.files) expect(sha256(Buffer.from(file.dataBase64, 'base64'))).toBe(file.sha256);
  expect(document.files.find((file: { path: string }) => file.path === 'README.md')).toBeDefined();
  expect(document.files.find((file: { path: string }) => file.path === 'plugin.json')).toBeDefined();
});


for (const fault of ['partial-write', 'rename', 'success']) test(`CLI publication is atomic on ${fault}`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'crystals-publish-'));
  try {
    for (const path of ['scripts', 'config', 'resources/extensions', 'apps/desktop/node_modules']) mkdirSync(join(directory, path), { recursive: true });
    copyFileSync(new URL('../scripts/crystals-bundle.mjs', import.meta.url), join(directory, 'scripts/crystals-bundle.mjs'));
    writeFileSync(join(directory, 'apps/desktop/package.json'), '{}');
    symlinkSync(dirname(require.resolve('fflate/package.json')), join(directory, 'apps/desktop/node_modules/fflate'), 'dir');
    const input = archive(), lock = lockFor(input), built = buildCrystalsBundle(input, lock);
    lock.bundle = { ...lock.bundle, bytes: built.bytes.length, sha256: sha256(built.bytes), compressor: built.compressor };
    writeFileSync(join(directory, 'config/crystals-resource.lock.json'), JSON.stringify(lock));
    const output = join(directory, lock.bundle.path), previous = Buffer.from('previous reviewed bundle remains intact');
    writeFileSync(output, previous);
    writeFileSync(join(directory, 'source.zip'), input);
    const preload = join(directory, 'fault.mjs');
    writeFileSync(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync, rename = fs.renameSync;
fs.writeFileSync = (target, bytes, ...options) => {
  if (process.env.BURETTE_TEST_PUBLICATION_FAULT === 'partial-write') {
    write(target, bytes.subarray(0, 17), ...options);
    throw Object.assign(new Error('INJECTED_PARTIAL_WRITE'), { code: 'ENOSPC' });
  }
  return write(target, bytes, ...options);
};
fs.renameSync = (...args) => {
  if (process.env.BURETTE_TEST_PUBLICATION_FAULT === 'rename') throw new Error('INJECTED_RENAME_FAILURE');
  return rename(...args);
};
syncBuiltinESMExports();
`);
    const result = spawnSync('node', ['--import', preload, 'scripts/crystals-bundle.mjs', '--write', '--archive', 'source.zip'], {
      cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024, env: { ...process.env, BURETTE_TEST_PUBLICATION_FAULT: fault },
    });
    if (fault === 'success') {
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, sha256: lock.bundle.sha256 });
      expect(readFileSync(output)).toEqual(built.bytes);
    } else {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(fault === 'partial-write' ? 'INJECTED_PARTIAL_WRITE' : 'INJECTED_RENAME_FAILURE');
      expect(readFileSync(output)).toEqual(previous);
    }
    expect(readdirSync(dirname(output))).toEqual(['openchemistry-crystals.bin']);
  } finally {
    if (process.platform === 'darwin') execFileSync('timeout', ['30', '/usr/bin/trash', directory]);
    else rmSync(directory, { recursive: true, force: true });
  }
});
