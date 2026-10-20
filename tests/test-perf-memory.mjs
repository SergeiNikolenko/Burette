import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributeProcesses, descendants, parseCoalition, parseProcesses, summarizeFootprint } from '../scripts/perf-memory.mjs';

test('process tree includes nested workers but excludes launchd WebKit siblings', () => {
  const processes = parseProcesses(`
    600 1 501 /tmp/Burette perf.app/Contents/MacOS/burette
    602 601 501 /tmp/worker
    601 600 501 /tmp/python
    603 1 501 /System/Library/WebKit/WebContent.xpc/Contents/MacOS/WebContent
  `);
  assert.deepEqual([...descendants(processes, 600)].sort(), [600, 601, 602]);
  assert.equal(processes[0].path, '/tmp/Burette perf.app/Contents/MacOS/burette');
});

test('coalition proof distinguishes unrelated WebKit and rejects absent metadata', () => {
  const proof = parseCoalition(`pid/603 = {
    environment = { SECRET = deliberately-not-exported }
    resource coalition = {
      ID = 1234
      type = resource
      name = application.com.google.drivefs.494343412.494343421
      bundle ID = com.google.drivefs
    }
    jetsam coalition = { ID = 9999 }
  }`);
  assert.deepEqual(proof, { id: '1234', bundleId: 'com.google.drivefs', name: 'application.com.google.drivefs.494343412.494343421' });
  assert.equal(parseCoalition('This subcommand requires root privileges'), null);
  assert.deepEqual(parseCoalition('resource coalition = {\n ID = 4\n type = resource\n}'), { id: '4', bundleId: null, name: null });
});

test('attribution requires app coalition proof and follows its XPC workers', () => {
  const processes = parseProcesses(`
    600 1 501 /tmp/Burette.app/Contents/MacOS/burette
    601 600 501 /tmp/python
    602 1 501 /System/WebContent.xpc/Contents/MacOS/WebContent
    603 1 501 /System/WebContent.xpc/Contents/MacOS/WebContent
    604 602 501 /tmp/worker
  `);
  const proofs = [
    { pid: 600, coalition: { id: '50', bundleId: 'test.perf' } },
    { pid: 602, coalition: { id: '50', bundleId: 'test.perf' } },
    { pid: 603, coalition: { id: '51', bundleId: 'other.application' } },
  ];
  const attributed = attributeProcesses(processes, 600, 'test.perf', proofs);
  assert.equal(attributed.verifiedCoalition, true);
  assert.deepEqual(attributed.members.map(({ pid, attribution }) => [pid, attribution]), [
    [600, 'requested-app-pid'], [601, 'ppid-descendant'],
    [602, 'matching-resource-coalition'], [604, 'ppid-descendant'],
  ]);
  const partial = attributeProcesses(processes, 600, 'different.bundle', proofs);
  assert.equal(partial.verifiedCoalition, false);
  assert.deepEqual(partial.members.map(member => member.pid), [600, 601]);
});

test('native footprint keeps numeric measurements and bounds diagnostic messages', () => {
  const result = summarizeFootprint({
    processes: [{ pid: 600, name: 'burette', footprint: 123, auxiliary: { phys_footprint: 123, phys_footprint_peak: 456 }, unrelated: 'discard' }],
    'total footprint': 123, errors: Array.from({ length: 100 }, () => 'x'.repeat(1000)), warnings: [], huge: 'discard',
  });
  assert.equal(result['total footprint'], 123);
  assert.equal(result.processes[0].auxiliary.phys_footprint_peak, 456);
  assert.equal(result.huge, undefined);
  assert.equal(result.errors.length, 32);
  assert.equal(result.errors[0].length, 300);
  assert.throws(() => summarizeFootprint({ processes: Array(257).fill({}) }), /oversized/);
});
