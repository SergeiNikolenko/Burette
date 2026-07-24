#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const NC_DIMENSION = 10;
const NC_VARIABLE = 11;
const NC_FLOAT = 5;

async function freePort() {
  const server = createServer();
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

function requestBuffer(url) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request(url, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolveRequest({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function paddedName(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
}

function emptyList() {
  return Buffer.concat([u32(0), u32(0)]);
}

function amberNetcdfBytes() {
  const variableSize = 2 * 3 * 4;
  const buildHeader = begin => Buffer.concat([
    Buffer.from('CDF\x01', 'binary'),
    u32(2),
    u32(NC_DIMENSION),
    u32(3),
    paddedName('frame'),
    u32(0),
    paddedName('atom'),
    u32(2),
    paddedName('spatial'),
    u32(3),
    emptyList(),
    u32(NC_VARIABLE),
    u32(1),
    paddedName('coordinates'),
    u32(3),
    u32(0),
    u32(1),
    u32(2),
    emptyList(),
    u32(NC_FLOAT),
    u32(variableSize),
    u32(begin),
  ]);
  const placeholder = buildHeader(0);
  const header = buildHeader(placeholder.length);
  assert.equal(header.length, placeholder.length);

  const data = Buffer.alloc(variableSize * 2);
  [
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
    10, 11, 12,
  ].forEach((value, index) => data.writeFloatBE(value, index * 4));
  return Buffer.concat([header, data]);
}

async function waitForHealth(port, child, log) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    try {
      const response = await requestBuffer(`http://127.0.0.1:${port}/healthz`);
      if (response.statusCode === 200) return;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error(`agent shell server did not become ready. stdout=${log.stdout} stderr=${log.stderr}`);
}

const tempDir = await mkdtemp(join(tmpdir(), 'burette-amber-nc-test-'));
const topologyPath = join(tempDir, 'reference.pdb');
const trajectoryPath = join(tempDir, 'trajectory.nc');
const outputPath = join(tempDir, 'preview.pdb');
const distDir = join(tempDir, 'dist');
const sessionDir = join(tempDir, 'session');

try {
  await writeFile(topologyPath, [
    'ATOM      1  N   GLY A   1       0.000   0.000   0.000  1.00  0.00           N  ',
    'ATOM      2  CA  GLY A   1       0.000   0.000   0.000  1.00  0.00           C  ',
    'END',
    '',
  ].join('\n'));
  await writeFile(trajectoryPath, amberNetcdfBytes());

  const extracted = spawnSync('python3', [
    'scripts/amber_nc_preview_extract.py',
    topologyPath,
    trajectoryPath,
    '--frames',
    '2',
    '--output',
    outputPath,
  ], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
  assert.match(extracted.stdout, /frames=2/);
  const pdb = await readFile(outputPath, 'utf8');
  assert.match(pdb, /^MODEL\s+1$/m);
  assert.match(pdb, /^MODEL\s+2$/m);
  assert.match(pdb, /  1\.000   2\.000   3\.000/);
  assert.match(pdb, / 10\.000  11\.000  12\.000/);

  await mkdir(distDir);
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Burette</title>');
  const port = await freePort();
  const log = { stdout: '', stderr: '' };
  const child = spawn(process.execPath, [
    'scripts/agent-shell-server.mjs',
    '--dist',
    distDir,
    '--session-dir',
    sessionDir,
    '--allow',
    tempDir,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { log.stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { log.stderr += chunk.toString('utf8'); });
  try {
    await waitForHealth(port, child, log);
    const url = new URL(`http://127.0.0.1:${port}/__burette/trajectory-preview`);
    url.searchParams.set('path', trajectoryPath);
    const response = await requestBuffer(url);
    assert.equal(response.statusCode, 200, response.body.toString('utf8'));
    assert.equal(response.headers['x-burette-trajectory-topology'], topologyPath);
    assert.equal(response.headers['x-burette-trajectory-frame-count'], '2');
    assert.equal(response.headers['x-burette-source-byte-count'], String((await stat(trajectoryPath)).size));
    const routedPdb = response.body.toString('utf8');
    assert.match(routedPdb, /^MODEL\s+1$/m);
    assert.match(routedPdb, /^MODEL\s+2$/m);
  } finally {
    child.kill('SIGTERM');
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('Amber NetCDF preview tests passed');
