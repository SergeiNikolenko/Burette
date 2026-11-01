import { test, expect, beforeEach, afterAll } from 'bun:test';
import { Window } from 'happy-dom';
import { requestIndexedTrajectoryFrame, type IndexedTrajectoryFrame } from '../apps/desktop/src/lib/indexed-trajectory-frame';
import { validateTrajectoryFrameRequest, validateTrajectoryFrameResult } from '../scripts/trajectory-frame-data.mjs';

const dom = new Window({ url: 'http://localhost/' });
const descriptors = new Map(['window', 'document', 'CSS', 'getComputedStyle'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const [name, value] of Object.entries({ window: dom, document: dom.document, CSS: dom.CSS, getComputedStyle: dom.getComputedStyle.bind(dom) })) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
afterAll(() => { for (const [name, descriptor] of descriptors) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name); });
beforeEach(() => { dom.document.body.replaceChildren(); });
const result = (includeSummary = false): IndexedTrajectoryFrame => ({ available: true, sourceId: 'source-a', modelId: 'model-a', structureRef: 'structure-a', frameIndex: 1, frameCount: 2, segmentIndex: 0,
  time: { value: 2.75, unit: 'ps' }, step: 125, units: { position: 'angstrom', velocity: 'angstrom/ps', force: 'kcal/mol/angstrom' },
  offset: 0, total: 1, summary: includeSummary ? { maxForce: 5, rmsForce: 5, rmsSpeed: 3 } : {}, atoms: [{ index: 0, sourceAtomIndex: 0, element: 'C', position: [1, 2, 3], velocity: [3, 0, 0], force: [0, 3, 4] }] });
function viewer() {
  const frame = dom.document.createElement('iframe'); frame.className = 'viewer-iframe'; frame.dataset.documentId = 'doc'; dom.document.body.append(frame);
  const source = frame.contentWindow! as Window;
  const requests: any[] = [];
  source.postMessage = (message: any) => { requests.push(message); };
  const reply = (value: unknown, wrongSource = false) => dom.dispatchEvent(new dom.MessageEvent('message', {
    source: wrongSource ? dom : source,
    data: { source: 'burette-agent-viewer', body: { type: 'agent-action-result', id: requests.at(-1).body.id, result: { ok: true, result: value } } },
  }));
  return { frame, requests, reply };
}

test('typed host read binds document and requested frame, ignoring other windows', async () => {
  const { requests, reply } = viewer();
  const pending = requestIndexedTrajectoryFrame('doc', { expected: { frameIndex: 1 } });
  expect(requests[0].body.action).toEqual({ type: 'indexed_trajectory_frame', offset: 0, limit: 100, includeSummary: false, expected: { frameIndex: 1 } });
  reply({ ...result(), frameIndex: 0 }, true);
  reply(result());
  expect(await pending).toEqual(result());
});

test('paging rejects changed frames and malformed vector payloads', async () => {
  const { reply } = viewer();
  const pending = requestIndexedTrajectoryFrame('doc', { expected: { sourceId: 'source-b', frameIndex: 1 } });
  reply(result());
  await expect(pending).rejects.toThrow('changed');
  for (const malformed of [
    { ...result(), atoms: Array(101).fill(result().atoms[0]) },
    { ...result(), total: 5000001 },
    { ...result(), summary: { rmsForce: NaN } },
    { ...result(), atoms: [{ ...result().atoms[0], force: [1, Infinity, 3] }] },
    { ...result(), units: { position: 'nm' } },
    { ...result(), unexpected: 'unbounded data' },
    { ...result(), atoms: [{ ...result().atoms[0], rawSource: 'unbounded data' }] },
    { ...result(), time: { value: 0, unit: 'ps', rawFrames: [] } },
    { ...result(), units: { ...result().units, unknown: 'data' } },
  ]) expect(() => validateTrajectoryFrameResult(malformed)).toThrow('invalid trajectory');
  expect(() => validateTrajectoryFrameRequest({ limit: 101 })).toThrow('1–100');
  expect(() => validateTrajectoryFrameRequest({ expected: {} })).toThrow('identity');
  expect(validateTrajectoryFrameResult(result(true), { includeSummary: true })).toEqual(result(true));
  expect(() => validateTrajectoryFrameResult(result(true))).toThrow('statistics');
  expect(() => validateTrajectoryFrameResult(result(), { includeSummary: true })).toThrow('statistics');
  expect(validateTrajectoryFrameResult({ available: false })).toEqual({ available: false });
  expect(() => validateTrajectoryFrameResult({ available: false }, { expected: { frameIndex: 0 } })).toThrow('changed');
});

test('abort and replaced/closed viewers cannot publish late frame responses', async () => {
  const old = viewer(); const controller = new AbortController();
  const pending = requestIndexedTrajectoryFrame('doc', {}, controller.signal); controller.abort();
  await expect(pending).rejects.toThrow('cancelled'); old.reply(result());
  const closed = requestIndexedTrajectoryFrame('doc'); old.frame.remove(); viewer(); old.reply(result());
  await expect(closed).rejects.toThrow('viewer changed');
  const already = new AbortController(); already.abort();
  await expect(requestIndexedTrajectoryFrame('doc', {}, already.signal)).rejects.toThrow();
});
