#!/usr/bin/env node
// Re-reduce a completed scale run; never replace its original evidence.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { reduceScaleSwitches, scaleIntegrity } from './perf-scalability-metrics.mjs';

const [sourcePath, destinationPath] = process.argv.slice(2);
if (!sourcePath || !destinationPath) throw Error('Usage: perf-scalability-derive.mjs <original-report.json> <new-derived-report.json>');
const source = resolve(sourcePath), destination = resolve(destinationPath);
const rawPath = `${source}.trace.jsonl`;
const sourceText = readFileSync(source, 'utf8');
const rawText = readFileSync(rawPath, 'utf8');
const original = JSON.parse(sourceText);
const lines = rawText.trim().split('\n').filter(Boolean).map(JSON.parse);
const actions = lines.filter(event => event.name === 'agent:action' && event.detail?.type === 'manage_tabs' && event.detail.failed === false);
if (actions.length !== 32) throw Error(`The legacy driver protocol requires exactly 8 warm-up + 24 measured actions; observed ${actions.length}`);
const measured = actions.slice(8).map(event => ({ startedAt: event.at, finishedAt: event.at + (event.ms ?? 0), id: event.detail.id }));
const until = Date.parse(original.finishedAt);
const reduction = reduceScaleSwitches(lines, measured, until);
const hash = text => createHash('sha256').update(text).digest('hex');
const derived = {
  ...original,
  derivation: {
    generatedAt: new Date().toISOString(), kind: 'reduction-of-existing-evidence-not-a-new-native-run',
    sources: [{ path: source, sha256: hash(sourceText) }, { path: rawPath, sha256: hash(rawText) }],
    method: 'The saved driver issued 8 warm-up then 24 measured focus actions. Exactly 32 successful manage_tabs records are present. Match the last 24 action intervals to document:visible journey start times after the full trace is available.',
    limitations: ['Measurement boundaries are reconstructed from the verified legacy action order, not a saved explicit measurement marker.',
      'Legacy marks have no stream/seq or loss diagnostics. Independent document counts still prove silent loss.',
      'Same native run and changing host load; rAF-visible iframe is not an OS-presented molecular frame.',
      original.memoryScope],
    originalSwitchCount: original.switches.length,
  },
  switchActions: measured,
  switchMeasurement: { expected: 24, startedAt: measured[0].startedAt, finishedAt: until, reconstructed: true },
  switches: reduction.switches, switchSummary: reduction.summary, switchIntegrity: reduction.integrity,
  traceProtocol: 'legacy',
};
let previous = 0;
derived.samples = original.samples.map(sample => {
  const paths = new Set(Array.from({ length: sample.total - previous }, (_, offset) =>
    join(original.fixture.path, `scale-${String(previous + offset).padStart(4, '0')}.pdb`)));
  previous = sample.total;
  const added = lines.filter(event => event.name === 'document:added' && paths.has(event.detail?.path));
  return { ...sample, tracedDocumentsAdded: added.length, tracedUniqueDocumentsAdded: new Set(added.map(event => event.detail.documentId)).size };
});
derived.integrity = scaleIntegrity(derived);
derived.failure = derived.integrity.status === 'pass' ? original.failure : `Measurement integrity failed: ${derived.integrity.failures.join('; ')}`;
writeFileSync(destination, JSON.stringify(derived, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ destination, switchSummary: derived.switchSummary, integrity: derived.integrity }, null, 2));
