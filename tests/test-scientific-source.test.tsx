import { plugin } from "bun";
import { afterAll, expect, mock, test } from "bun:test";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act, useLayoutEffect } from "react";
import type { ViewerDocument } from "../apps/desktop/src/types";

plugin({ name: "source-text-react-compiler", setup(build) {
  build.onLoad({ filter: /(?:use-structure-source-text|source)\.ts$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "ts",
  }));
} });
const browser = new Window(), previous = new Map<string, PropertyDescriptor | undefined>();
Object.assign(browser, { __TAURI_INTERNALS__: {} });
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Node: browser.Node, Event: browser.Event, CustomEvent: browser.CustomEvent,
  MutationObserver: browser.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, value] of previous) {
  if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
type Read = { path: string; resolve: (text: string) => void; reject: (error: Error) => void };
const reads: Read[] = [];
const bridge = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...bridge, invoke: (command: string, args: { path: string }) => {
  if (command !== "read_structure_text") throw new Error(`Unexpected bridge command: ${command}`);
  return new Promise<string>((resolve, reject) => reads.push({ path: args.path, resolve, reject }));
} }));
const { createRoot } = await import("react-dom/client");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { adoptLogicalSource, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { parseScientificFile } = await import('../apps/desktop/src/lib/molecular-workbench/quantum');
const { useScientificDocument, useTrajectoryFrame, addDocumentInternalCoordinates, recordImportedRevision, releaseClosedImports, useImportedRevisions } = await import('../apps/desktop/src/lib/workbench/source');
type Request = { action: string; name: string; text: string };
const workerBuild = await Bun.build({ entrypoints: [new URL('../apps/desktop/src/lib/workbench/reader-worker.ts', import.meta.url).pathname], target: 'browser' });
if (!workerBuild.success) throw new AggregateError(workerBuild.logs, 'Reader worker build failed');
const workerCode = await workerBuild.outputs[0].text();
const jobs: ReaderTransport[] = [];
class ReaderTransport {
  request!: Request; onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null; terminated = false;
  constructor(url: URL) { expect(url.pathname.endsWith('/reader-worker.ts')).toBe(true); jobs.push(this); }
  postMessage(request: Request) { this.request = request; }
  terminate() { this.terminated = true; }
  async deliver() {
    const scope = { onmessage: null as unknown as (event: { data: Request }) => Promise<void>,
      postMessage: (data: unknown) => this.onmessage?.({ data }) };
    new Function('globalThis', workerCode)(scope);
    await scope.onmessage({ data: this.request });
  }
}
previous.set('Worker', Object.getOwnPropertyDescriptor(globalThis, 'Worker'));
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ReaderTransport });
const xyz = (x: number) => `1\nframe ${x}\nH ${x} 0 0\n`;
let sequence = 0;
const doc = () => ({ id: `science-${++sequence}`, path: `/science-${sequence}.xyz`, title: 'source.xyz', extension: 'xyz', renderer: 'molstar' }) as ViewerDocument;
async function fixture() {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let seen: ReturnType<typeof useScientificDocument> = { document: null, text: null }, frame: ReturnType<typeof useTrajectoryFrame> = null;
  let revisions = 0; const committed: typeof seen[] = [];
  function Probe({ document }: { document: ViewerDocument | null }) {
    seen = useScientificDocument(document); frame = useTrajectoryFrame(document?.id ?? null);
    revisions = useImportedRevisions(document?.id ?? null, seen.text ?? '')?.length ?? 0;
    useLayoutEffect(() => { committed.push(seen); }); return null;
  }
  return { seen: () => seen, frame: () => frame, revisions: () => revisions, committed,
    async render(document: ViewerDocument | null, content?: string) {
      const value = { sessionForDocument: (candidate: ViewerDocument | null) => candidate && content !== undefined ? { documentId: candidate.id, content } : null };
      await act(async () => root.render(<SourceEditingProvider value={value as never}><Probe document={document} /></SourceEditingProvider>));
    }, async close() { await act(async () => root.unmount()); host.remove(); } };
}
const settle = async (job: ReaderTransport) => act(async () => job.deliver());
test('shared reads and parsing preserve physical source; replacement and late reply never publish old geometry', async () => {
  const d = doc(), a = await fixture(), b = await fixture(), start = reads.length, j = jobs.length;
  try {
    await a.render(d); await b.render(d); expect(reads.length - start).toBe(1);
    await act(async () => reads[start].resolve(xyz(1))); expect(jobs.length - j).toBe(1);
    await settle(jobs[j]); expect([a.seen().document?.atoms[0], b.seen().document?.atoms[0]]).toEqual([{ element: 'H', x: 1, y: 0, z: 0 }, { element: 'H', x: 1, y: 0, z: 0 }]);
    await b.close(); await a.render({ ...d }); expect(a.seen()).toEqual({ document: null, text: null });
    await act(async () => reads[start + 1].resolve(xyz(2))); const late = jobs.at(-1)!;
    await a.render({ ...d }); await act(async () => reads[start + 2].resolve(xyz(3)));
    await settle(late); expect(a.seen()).toEqual({ document: null, text: null });
    await settle(jobs.at(-1)!); expect(a.seen().document?.atoms[0]).toEqual({ element: 'H', x: 3, y: 0, z: 0 });
  } finally { await a.close(); }
});
test('registered revisions are synchronous, share the existing owner and override pending parser output', async () => {
  const d = doc(), f = await fixture(), text = xyz(4), parsed = parseScientificFile('x.xyz', text);
  try {
    await f.render(d, text); const pending = jobs.at(-1)!;
    await act(async () => addDocumentInternalCoordinates(d.id, text, parsed));
    expect(f.seen()).toEqual({ text, document: parsed }); expect(f.revisions()).toBe(1);
    const next = xyz(5), nextScience = parseScientificFile('x.xyz', next);
    await act(async () => { recordImportedRevision(d.id, text, { text: next, document: nextScience }); });
    await f.render(d, next); expect(f.seen()).toEqual({ text: next, document: nextScience }); expect(f.revisions()).toBe(2);
    await f.render(d, text); await settle(pending); expect(f.seen()).toEqual({ text, document: parsed });
  } finally { await f.close(); releaseClosedImports(new Set()); }
});
for (const overlay of ['draft', 'logical'] as const) test(`${overlay} removal starts fresh file read and drops late parsed overrides`, async () => {
  const d = doc(), f = await fixture(), start = reads.length;
  try {
    await f.render(d); await act(async () => reads[start].resolve(xyz(6))); await settle(jobs.at(-1)!);
    if (overlay === 'draft') await f.render(d, xyz(7));
    else await act(async () => adoptLogicalSource({ documentId: d.id, extension: 'xyz', text: xyz(7) }, 'science-restore', null, []));
    const old = jobs.at(-1)!;
    if (overlay === 'draft') await f.render(d); else await act(async () => releaseClosedScienceSessions(new Set()));
    expect(reads.length - start).toBe(2); await settle(old); expect(f.seen()).toEqual({ document: null, text: null });
    await act(async () => reads[start + 1].resolve(xyz(8))); await settle(jobs.at(-1)!);
    expect(f.seen().document?.atoms[0]).toEqual({ element: 'H', x: 8, y: 0, z: 0 });
  } finally { await f.close(); releaseClosedScienceSessions(new Set()); }
});
test('frame reports clamp and persist for remount without crossing document identity', async () => {
  const d = doc(), f = await fixture();
  try {
    await f.render(null);
    await act(async () => browser.dispatchEvent(new browser.CustomEvent('burette:trajectory-frame-changed', { detail: { documentId: d.id, frameIndex: 9, frameCount: 3 } })));
    await f.render(d, xyz(0)); expect(f.frame()).toEqual({ frameIndex: 2, frameCount: 3 });
    await f.render(doc(), xyz(0)); expect(f.frame()).toBeNull();
    for (const job of jobs.filter(job => !job.terminated)) await settle(job);
  } finally { await f.close(); }
});
