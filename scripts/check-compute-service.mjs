#!/usr/bin/env bun

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const app = process.argv[2] ? resolve(process.argv[2]) : '';
if (!app || process.argv.length !== 3) {
  throw new Error('Usage: check-compute-service.mjs APP_BUNDLE');
}

const service = join(app, 'Contents', 'Helpers', 'burette-compute-service');
const runtime = join(app, 'Contents', 'Resources', 'ComputeMetal');
const sessionToken = `session.v1.${randomBytes(32).toString('base64url')}`;
const coordinatorNonce = randomBytes(32).toString('base64url');
const child = spawn(service, ['--runtime-root', runtime], {
  env: { ...process.env, BURETTE_COMPUTE_SESSION_TOKEN: sessionToken },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = Buffer.alloc(0);
let stderr = '';
const waiters = [];
child.stdout.on('data', (chunk) => {
  stdout = Buffer.concat([stdout, chunk]);
  drainFrames();
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

function drainFrames() {
  while (stdout.length >= 4) {
    const length = stdout.readUInt32BE(0);
    if (length > 1024 * 1024) throw new Error(`Compute service emitted oversized frame: ${length}`);
    if (stdout.length < length + 4) return;
    const payload = stdout.subarray(4, length + 4);
    stdout = stdout.subarray(length + 4);
    const waiter = waiters.shift();
    if (!waiter) throw new Error('Compute service emitted an unsolicited response');
    waiter.resolve(JSON.parse(payload.toString('utf8')));
  }
}

function request(command, requestId = randomUUID()) {
  const payload = Buffer.from(JSON.stringify({ protocolVersion: 1, requestId, command }));
  if (payload.length > 1024 * 1024) throw new Error('Compute service request is oversized');
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  const response = new Promise((resolveResponse, reject) => {
    const timeout = setTimeout(() => reject(new Error('Compute service response timed out')), 10_000);
    waiters.push({
      resolve(value) {
        clearTimeout(timeout);
        resolveResponse(value);
      },
    });
  });
  child.stdin.write(frame);
  return response;
}

try {
  const handshake = await request({ kind: 'handshake', sessionToken, coordinatorNonce });
  if (handshake.result?.kind !== 'handshakeAccepted'
      || handshake.result.coordinatorNonce !== coordinatorNonce) {
    throw new Error(`Compute service handshake failed: ${JSON.stringify(handshake)}`);
  }
  const capabilityRequestId = randomUUID();
  const capability = await request({ kind: 'capabilities', sessionToken }, capabilityRequestId);
  const report = capability.result?.report;
  if (capability.result?.kind !== 'capabilities' || report?.availability !== 'available') {
    throw new Error(`Compute service Metal capability failed: ${JSON.stringify(capability)}`);
  }
  const helperSha256 = createHash('sha256').update(readFileSync(service)).digest('hex');
  if (report.runtime?.helperSha256 !== helperSha256) {
    throw new Error('Compute service runtime identity is not bound to the packaged helper');
  }
  const replay = await request({ kind: 'capabilities', sessionToken }, capabilityRequestId);
  if (replay.result?.kind !== 'error' || replay.result.code !== 'conflict') {
    throw new Error(`Compute service accepted a replayed request: ${JSON.stringify(replay)}`);
  }
  console.log(JSON.stringify({
    status: 'ok',
    service,
    runtimeVersion: report.runtime.version,
    device: report.device.name,
    helperSha256,
  }));
} finally {
  child.stdin.end();
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code))),
    new Promise((resolveExit) => setTimeout(() => resolveExit(null), 2_000)),
  ]);
  if (exited === null) child.kill('SIGKILL');
  if (stderr.trim()) process.stderr.write(stderr);
}
