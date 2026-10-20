#!/usr/bin/env node
// Read-only memory snapshot of one app, its descendants and coalition-owned XPCs.
// node scripts/perf-memory.mjs --pid 1234 --bundle-id com.local.BuretteV10.Dev.perf
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const command = (file, args) => run(file, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
const maxFootprintBytes = 16 * 1024 * 1024;
const bytes = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const messages = values => Array.isArray(values) ? values.slice(0, 32).map(value =>
  (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 300)) : [];

export function summarizeFootprint(value) {
  if (!Array.isArray(value.processes) || value.processes.length > 256) throw Error('Invalid or oversized footprint process list.');
  return {
    processes: value.processes.map(process => ({
      pid: bytes(process.pid), name: String(process.name ?? '').slice(0, 160), footprint: bytes(process.footprint),
      auxiliary: { phys_footprint: bytes(process.auxiliary?.phys_footprint), phys_footprint_peak: bytes(process.auxiliary?.phys_footprint_peak) },
    })),
    errors: messages(value.errors), warnings: messages(value.warnings),
    'total footprint': bytes(value['total footprint']),
  };
}

export function parseProcesses(output) {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), path: match[4] }] : [];
  });
}

export function parseCoalition(output) {
  const block = output.match(/\bresource coalition = \{([^}]+)\}/)?.[1];
  if (!block) return null;
  const id = block.match(/^\s*ID = (\d+)\s*$/m)?.[1];
  const bundleId = block.match(/^\s*bundle ID = (.+?)\s*$/m)?.[1];
  const name = block.match(/^\s*name = (.+?)\s*$/m)?.[1];
  return id ? { id: id.slice(0, 32), bundleId: bundleId?.slice(0, 256) ?? null, name: name?.slice(0, 512) ?? null } : null;
}

export function descendants(processes, rootPid) {
  const owned = new Set([rootPid]);
  let added;
  do {
    added = false;
    for (const process of processes) {
      if (owned.has(process.ppid) && !owned.has(process.pid)) {
        owned.add(process.pid);
        added = true;
      }
    }
  } while (added);
  return owned;
}

export function attributeProcesses(processes, pid, bundleId, proofs) {
  const owned = descendants(processes, pid);
  const rootCoalition = proofs.find(proof => proof.pid === pid)?.coalition;
  const verifiedCoalition = rootCoalition?.bundleId === bundleId;
  if (verifiedCoalition) {
    for (const proof of proofs) {
      if (proof.coalition?.id === rootCoalition.id && proof.coalition.bundleId === bundleId) owned.add(proof.pid);
    }
  }
  for (const ownedPid of [...owned]) {
    for (const child of descendants(processes, ownedPid)) owned.add(child);
  }
  const members = processes.filter(process => owned.has(process.pid)).map(process => ({
    ...process,
    attribution: process.pid === pid ? 'requested-app-pid' :
      proofs.some(proof => proof.pid === process.pid && proof.coalition?.id === rootCoalition?.id && verifiedCoalition)
        ? 'matching-resource-coalition' : 'ppid-descendant',
  }));
  return { rootCoalition, verifiedCoalition, members };
}

export async function memorySnapshot(pid, bundleId, { rawEvidencePath } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !bundleId) throw new Error('A positive PID and bundle ID are required.');
  const startedAt = new Date().toISOString();
  const processes = parseProcesses((await command('/bin/ps', ['-axo', 'pid=,ppid=,uid=,comm='])).stdout);
  const root = processes.find(process => process.pid === pid);
  if (!root) throw new Error(`Process ${pid} is not running.`);
  const owned = descendants(processes, pid);
  // XPCs are usually children of launchd, so PPID alone cannot attribute WebKit.
  // Probe all same-user XPCs; never count an XPC merely because its name is WebKit.
  const candidates = processes.filter(process => process.pid === pid ||
    (process.uid === root.uid && process.path.includes('.xpc/')));
  if (candidates.length > 256 || owned.size > 256) throw new Error('Process inventory exceeds the 256-process snapshot bound.');
  const proofs = [];
  for (let index = 0; index < candidates.length; index += 4) {
    proofs.push(...await Promise.all(candidates.slice(index, index + 4).map(async process => {
      try {
        const coalition = parseCoalition((await command('/bin/launchctl', ['print', `pid/${process.pid}`])).stdout);
        return { pid: process.pid, path: process.path, coalition };
      } catch (error) {
        return { pid: process.pid, path: process.path, coalition: null, error: String(error.message).slice(0, 300) };
      }
    })));
  }
  const { rootCoalition, verifiedCoalition, members } = attributeProcesses(processes, pid, bundleId, proofs);
  if (members.length > 256) throw new Error('Owned process inventory exceeds the 256-process snapshot bound.');
  const directory = await mkdtemp(join(tmpdir(), 'burette-perf-memory-'));
  let footprint;
  try {
    const path = join(directory, 'footprint.json');
    await command('/usr/bin/footprint', ['--noCategories', '-f', 'bytes', '-j', path,
      ...members.flatMap(member => ['-p', String(member.pid)])]);
    const file = await open(path, 'r');
    try {
      const size = (await file.stat()).size;
      if (size > maxFootprintBytes) throw Error('Footprint evidence exceeds 16 MiB.');
      // Bound the read itself as well as stat: an unexpected growing output
      // cannot turn a diagnostic into an unbounded agent-visible payload.
      const buffer = Buffer.alloc(size + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > size) throw Error('Footprint evidence changed during capture.');
      const raw = buffer.subarray(0, bytesRead);
      footprint = summarizeFootprint(JSON.parse(raw.toString('utf8')));
      if (rawEvidencePath) await writeFile(rawEvidencePath, raw, { flag: 'wx' });
    } finally {
      await file.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const measuredPids = new Set((footprint.processes ?? []).map(process => process.pid));
  const missingPids = members.filter(member => !measuredPids.has(member.pid)).map(member => member.pid);
  return {
    schema: 'burette-perf-memory-v1', startedAt, endedAt: new Date().toISOString(), pid, bundleId,
    attributionComplete: Boolean(verifiedCoalition && proofs.every(proof => proof.coalition) && missingPids.length === 0 &&
      !(footprint.errors?.length) && !(footprint.warnings?.length)),
    rootCoalition: rootCoalition ?? null, members, coalitionProofs: proofs, missingPids,
    rawEvidencePath: rawEvidencePath ?? null,
    totalFootprintBytes: footprint['total footprint'] ?? null,
    footprint,
    limitations: [
      'Point-in-time snapshot; a sampled maximum is a lower bound on the simultaneous peak.',
      'Per-process phys_footprint_peak values are lifetime peaks, not a simultaneous group peak.',
      'Ownership covers PPID descendants and same-user XPC executables in the app resource coalition.',
      ...(!verifiedCoalition ? ['App resource coalition bundle ID was not verified; XPC memory is excluded and totals are partial.'] : []),
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--pid' || args[2] !== '--bundle-id') {
      throw new Error('Usage: node scripts/perf-memory.mjs --pid <pid> --bundle-id <bundle-id>');
    }
    const snapshot = await memorySnapshot(Number(args[1]), args[3]);
    console.log(JSON.stringify({
      pid: snapshot.pid, bundleId: snapshot.bundleId, attributionComplete: snapshot.attributionComplete,
      totalFootprintBytes: snapshot.totalFootprintBytes, members: snapshot.members.map(({ pid, attribution }) => ({ pid, attribution })),
      missingPids: snapshot.missingPids, errors: snapshot.footprint.errors, warnings: snapshot.footprint.warnings,
      limitations: snapshot.limitations,
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
