#!/usr/bin/env node
// Independent read-only sampler: it never launches, pauses or stops the app.
// node scripts/perf-memory-sample.mjs --pid PID --bundle-id ID --out fresh.jsonl --samples 30
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { memorySnapshot } from './perf-memory.mjs';

const options = { intervalMs: 1000, samples: 30 };
const names = { '--pid': 'pid', '--bundle-id': 'bundleId', '--out': 'out', '--interval-ms': 'intervalMs', '--samples': 'samples' };
for (let index = 2; index < process.argv.length; index += 2) {
  const name = names[process.argv[index]], value = process.argv[index + 1];
  if (!name || value === undefined) throw Error('Usage: perf-memory-sample.mjs --pid PID --bundle-id ID --out fresh.jsonl [--interval-ms 1000] [--samples 30]');
  options[name] = ['pid', 'intervalMs', 'samples'].includes(name) ? Number(value) : value;
}
if (!Number.isSafeInteger(options.pid) || options.pid <= 0 || !options.bundleId || !options.out ||
  !Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1000 || options.intervalMs > 60000 ||
  !Number.isSafeInteger(options.samples) || options.samples < 1 || options.samples > 3600) throw Error('Invalid sampler options.');
const out = resolve(options.out), summaryPath = `${out}.summary.json`;
if (existsSync(out) || existsSync(summaryPath)) throw Error('Refusing to overwrite memory evidence.');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, '', { flag: 'wx' });
const summary = {
  startedAt: new Date().toISOString(), pid: options.pid, bundleId: options.bundleId,
  intervalMs: options.intervalMs, requested: options.samples, captured: 0, complete: 0, errors: [],
  sampledPeakBytes: null, firstBytes: null, lastBytes: null,
  limitation: 'Sampled peak is a lower bound on the simultaneous peak. The sampler and footprint scans add load; do not compare these runs with uninstrumented latency runs.',
};
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
try {
  for (let index = 0; index < options.samples && !stopping; index++) {
    const started = Date.now();
    try {
      const snapshot = await memorySnapshot(options.pid, options.bundleId);
      appendFileSync(out, `${JSON.stringify({ index, ...snapshot })}\n`);
      summary.captured++;
      if (snapshot.attributionComplete && Number.isFinite(snapshot.totalFootprintBytes)) {
        summary.complete++;
        summary.firstBytes ??= snapshot.totalFootprintBytes;
        summary.lastBytes = snapshot.totalFootprintBytes;
        summary.sampledPeakBytes = Math.max(summary.sampledPeakBytes ?? 0, snapshot.totalFootprintBytes);
      }
    } catch (error) {
      summary.errors.push({ index, error: error.message });
      break;
    }
    if (index + 1 < options.samples && !stopping) {
      await new Promise(done => setTimeout(done, Math.max(0, options.intervalMs - (Date.now() - started))));
    }
  }
} finally {
  summary.finishedAt = new Date().toISOString();
  summary.interrupted = stopping;
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(summary));
}
if (summary.complete !== summary.captured || summary.errors.length || !summary.captured) process.exitCode = 1;
