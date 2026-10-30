import { afterAll, expect, test } from 'bun:test';
import { plugin } from 'bun';
import { transformSync } from '@babel/core';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import type { ViewerDocument } from '../apps/desktop/src/types';
plugin({ name: 'geometry-sender-compiler', setup(build) {
  build.onLoad({ filter: /use-app-molstar-action-senders\.ts$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, 'utf8'), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ['typescript'] }, plugins: [['babel-plugin-react-compiler', {}]] })!.code!, loader: 'ts',
  }));
} });
const browser = new Window({ url: 'http://localhost/' }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Element: browser.Element,
  Node: browser.Node, CSS: browser.CSS, Event: browser.Event, MessageEvent: browser.MessageEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
const { createRoot } = await import('react-dom/client');
const { useAppMolstarActionSenders } = await import('../apps/desktop/src/hooks/use-app-molstar-action-senders');
const { requestViewerAction, activeViewerIframeForDocument } = await import('../apps/desktop/src/lib/viewer-bridge');
const action = { type: 'update_geometry', label: 'Geometry', text: '1\nH\nH 0 0 0\n', notify: false } as const;
let serial = 0;
async function fixture() {
  const doc = { id: `ack-${++serial}`, path: '/h.xyz', title: 'h.xyz', extension: 'xyz', renderer: 'molstar' } as ViewerDocument;
  const host = document.createElement('div'); document.body.append(host); const frame = document.createElement('iframe');
  frame.className = 'viewer-iframe'; frame.dataset.documentId = doc.id; frame.dataset.renderer = 'molstar'; host.append(frame);
  const sent: { source: string; body: { id: string; action: typeof action } }[] = [];
  frame.contentWindow!.postMessage = payload => sent.push(payload);
  const rootHost = document.createElement('div'); host.append(rootHost); const root = createRoot(rootHost);
  let api!: ReturnType<typeof useAppMolstarActionSenders>;
  function Probe() { api = useAppMolstarActionSenders({ activeDocument: doc, documents: [doc], activeViewerIframeForDocument, pushStatus() {} }); return null; }
  await act(async () => root.render(<Probe />));
  const source = frame.contentWindow!;
  const reply = (id: string, result: unknown, from = source) => window.dispatchEvent(new MessageEvent('message', {
    source: from, data: { source: 'burette-agent-viewer', body: { type: 'agent-action-result', id, result } },
  }));
  return { doc, frame, host, sent, api, reply, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
test('compiled sender waits for matching frame and request ACK, returning the actual result', async () => {
  const f = await fixture();
  try {
    let done = false; const pending = Promise.resolve(f.api.runStructureViewerAction(f.doc, action)).then(result => { done = true; return result; });
    expect(f.sent[0].body.action).toEqual(action); expect(done).toBe(false);
    f.reply('other-request', { ok: true }); await Promise.resolve(); expect(done).toBe(false);
    f.reply(f.sent[0].body.id, { ok: true }, window); await Promise.resolve(); expect(done).toBe(false);
    f.reply(f.sent[0].body.id, { ok: true, result: { atomCount: 1 } }); expect(await pending).toEqual({ atomCount: 1 });
  } finally { await f.close(); }
});
test('negative ACK and a frame replaced before ACK reject instead of committing', async () => {
  const f = await fixture();
  try {
    const failure = Promise.resolve(f.api.runStructureViewerAction(f.doc, action));
    const rejected = failure.catch(error => error.message);
    f.reply(f.sent[0].body.id, { ok: false, error: { message: 'Mismatched atoms' } }); expect(await rejected).toBe('Mismatched atoms');
    const moved = Promise.resolve(f.api.runStructureViewerAction(f.doc, action)); const movedCheck = moved.catch(error => error.message);
    f.frame.remove(); f.reply(f.sent[1].body.id, { ok: true }); expect(await movedCheck).toContain('viewer changed');
  } finally { await f.close(); }
});
test('cancelled transport ignores late ACK and does not settle a later request', async () => {
  const f = await fixture();
  try {
    const abort = new AbortController(); const cancelled = requestViewerAction(f.doc.id, action, 1000, abort.signal);
    const check = cancelled.catch(error => error.message); abort.abort(); expect(await check).toContain('cancelled');
    let done = false; const next = Promise.resolve(f.api.runStructureViewerAction(f.doc, action)).then(() => { done = true; });
    f.reply(f.sent[0].body.id, { ok: true }); await Promise.resolve(); expect(done).toBe(false);
    f.reply(f.sent[1].body.id, { ok: true }); await next; expect(done).toBe(true);
  } finally { await f.close(); }
});
test('timeout, missing frame and read-only frame fail closed', async () => {
  const f = await fixture();
  try {
    await expect(requestViewerAction(f.doc.id, action, 1)).rejects.toThrow('did not respond');
    f.frame.dataset.readOnly = 'true'; await expect(Promise.resolve(f.api.runStructureViewerAction(f.doc, action))).rejects.toThrow('wait for it to load');
    f.frame.remove(); await expect(Promise.resolve(f.api.runStructureViewerAction(f.doc, action))).rejects.toThrow('wait for it to load');
  } finally { await f.close(); }
});

test('independent: an owning frame made read-only while ACK is pending cannot report success',async()=>{
 const f=await fixture();try{
  const pending=Promise.resolve(f.api.runStructureViewerAction(f.doc,action));
  f.frame.dataset.readOnly='true';f.reply(f.sent[0].body.id,{ok:true,result:{atomCount:1}});
  await expect(pending).rejects.toThrow();
 }finally{await f.close();}
});
