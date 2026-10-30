import assert from "node:assert/strict";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
import { PluginContext } from "molstar/lib/mol-plugin/context.js";
import { BuretteGeometry } from "../scripts/molstar-geometry.js";
import { readGeometryBinding } from "../apps/desktop/src/lib/geometry-binding";
import { requestViewerAction } from "../apps/desktop/src/lib/viewer-bridge";
import { claimGeometryPreview, releaseGeometryPreview } from "../apps/desktop/src/lib/geometry-preview-owners";
import { adoptLogicalSource, beginScienceSessionRestore, logicalSourceFor } from "../apps/desktop/src/lib/science-session/state";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";

const dom = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, CSS: dom.CSS, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}
const plugin = new PluginContext({ actions: [], behaviors: [] });
const xyz = "3\r\nsource\r\nO 0 0 0\r\nH 1 0 0\r\nH 0 1 0\r\n";
const text = (value: number) => xyz.replace("H 1 0 0", `H ${value} 0 0`);
const doc = { id: "binding-integration", path: "/source.xyz", extension: "xyz", renderer: "molstar" } as ViewerDocument;
const token = {}, controller = new AbortController();
let frame!: HTMLIFrameElement;
let bindingReads = 0, posts = 0, heldDelivery: (() => void) | null = null, holdRead = false, readEntered: (() => void) | null = null;
type Envelope = { body: { action: { type: string } } };
type HostEvent = { data: unknown; source: { postMessage: (reply: unknown) => void } };
let receiveHost!: (event: HostEvent) => void;
const makeFrame = () => {
  const element = document.createElement("iframe"); element.className = "viewer-iframe";
  element.dataset.documentId = doc.id; element.dataset.renderer = "molstar"; document.body.append(element);
  const source = element.contentWindow!;
  Object.defineProperty(source, "postMessage", { configurable: true, value: (data: Envelope) => {
    posts++; if (data.body.action.type === "geometry_binding") bindingReads++;
    receiveHost({ data, source: { postMessage: (reply) => {
      const deliver = () => dom.dispatchEvent(new dom.MessageEvent("message", { source: source as unknown as typeof dom, data: reply }));
      if (holdRead && data.body.action.type === "geometry_binding") { holdRead = false; heldDelivery = deliver; readEntered?.(); }
      else deliver();
    } } });
  } });
  return element;
};
const send: ShellActions["runStructureViewerAction"] = (target, action, options) => requestViewerAction(target.id, action, 1000, options?.signal, { target: options?.target });
const apply = async (binding: Awaited<ReturnType<typeof readGeometryBinding>>, value: string) => send(doc,
  { type: "update_geometry", label: "Geometry", notify: false, lease: binding.lease, text: value }, { target: binding.target });
try {
  console.log("independent: plugin init"); await plugin.init(); console.log("independent: initialized");
  const raw = await plugin.builders.data.rawData({ data: xyz });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
  const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model);
  const server: Record<string, unknown> = { molstar: { BuretteGeometry }, BuretteAgent: { run() { throw new Error("Wrong route"); } } };
  vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/geometry-preview.js", import.meta.url), "utf8"), { window: server });
  server.addEventListener = (_name: string, callback: typeof receiveHost) => { receiveHost = callback; };
  const source = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
  const declaration = source.match(/\n  async function executeBuretteAgentAction\(action\) \{[\s\S]*?\n  \}/u)![0];
  const globals = source.slice(source.indexOf("  let geometryPreviewRequest ="), source.indexOf(declaration));
  const start = source.indexOf("  window.addEventListener('message', event => {", source.indexOf(declaration));
  const end = source.indexOf("  window.BuretteViewerActions =", start);
  const failure = source.match(/\n  function agentActionFailure\(command, code, message\) \{[\s\S]*?\n  \}/u)![0];
  const viewer = { plugin };
  new Function("window", "activeMolstarViewer", `${globals}\n${declaration}\n${failure}\n${source.slice(start, end)}`)(server, () => viewer);
  frame = makeFrame();
  console.log("independent: before first read"); const first = await readGeometryBinding(doc, send, () => true, controller.signal);
  assert.equal(first.text, xyz);
  assert.equal(claimGeometryPreview(doc.id, token, first.target.isCurrent), true);
  await apply(first, text(1.6));
  const readsBefore = bindingReads;
  const secondRead = readGeometryBinding(doc, send, () => true, controller.signal);
  await Promise.resolve(); assert.equal(bindingReads, readsBefore, "another model cannot read an active transient preview");
  await apply(first, xyz); releaseGeometryPreview(doc.id, token);
  const second = await secondRead;
  assert.equal(second.text, xyz, "B recovers after A rollback with unchanged canonical source, including CRLF bytes");

  holdRead = true;
  const entered = new Promise<void>(resolve => { readEntered = resolve; });
  const beforeABA = bindingReads, duringRead = readGeometryBinding(doc, send, () => true, controller.signal);
  await entered;
  assert.equal(claimGeometryPreview(doc.id, token, first.target.isCurrent), true);
  await apply(first, text(1.8)); await apply(first, xyz); releaseGeometryPreview(doc.id, token);
  assert.ok(heldDelivery); (heldDelivery as () => void)(); heldDelivery = null;
  assert.equal((await duringRead).text, xyz);
  assert.equal(bindingReads, beforeABA + 2, "claim/release ABA during ACK delivery discards the unread receipt and reads again");

  assert.equal(claimGeometryPreview(doc.id, token, first.target.isCurrent), true);
  let sourceCurrent = true;
  const oldSource = readGeometryBinding(doc, send, () => sourceCurrent, controller.signal);
  const beforeSource = posts; sourceCurrent = false; releaseGeometryPreview(doc.id, token);
  await assert.rejects(oldSource, { name: "AbortError" }); assert.equal(posts, beforeSource);
  assert.equal(claimGeometryPreview(doc.id, token, first.target.isCurrent), true);
  const oldTarget = readGeometryBinding(doc, send, () => true, controller.signal);
  const beforeTarget = posts; frame.remove(); frame = makeFrame(); releaseGeometryPreview(doc.id, token);
  await assert.rejects(oldTarget, { name: "AbortError" }); assert.equal(posts, beforeTarget, "waiting work never retargets a same-id replacement iframe");

  const current = await readGeometryBinding(doc, send, () => true, controller.signal);
  assert.equal(claimGeometryPreview(doc.id, token, current.target.isCurrent), true);
  const abort = new AbortController(), active = new Set<unknown>();
  const add = abort.signal.addEventListener, remove = abort.signal.removeEventListener;
  Object.defineProperty(abort.signal, "addEventListener", { value: (...args: unknown[]) => { if (args[0] === "abort") active.add(args[1]); return Reflect.apply(add, abort.signal, args); } });
  Object.defineProperty(abort.signal, "removeEventListener", { value: (...args: unknown[]) => { if (args[0] === "abort") active.delete(args[1]); return Reflect.apply(remove, abort.signal, args); } });
  const cancelled = readGeometryBinding(doc, send, () => true, abort.signal);
  abort.abort(); await assert.rejects(cancelled, { name: "AbortError" }); assert.equal(active.size, 0);
  releaseGeometryPreview(doc.id, token);
  assert.equal((await readGeometryBinding(doc, send, () => true, controller.signal)).text, xyz);

  adoptLogicalSource({ documentId: doc.id, extension: "xyz", text: xyz }, "source-a", null, ["O", "H", "H"]);
  const logicalA = logicalSourceFor(doc.id);
  beginScienceSessionRestore(doc.id);
  const beforeRestoreRead = posts;
  await assert.rejects(readGeometryBinding(doc, send, () => logicalSourceFor(doc.id) === logicalA, controller.signal), { name: "AbortError" });
  assert.equal(posts, beforeRestoreRead, "a pending MOLX restore cannot mint a new runtime lease for old source metadata");
  adoptLogicalSource({ documentId: doc.id, extension: "xyz", text: xyz }, "source-b", null, ["O", "H", "H"]);
  await assert.rejects(readGeometryBinding(doc, send, () => logicalSourceFor(doc.id) === logicalA, controller.signal), { name: "AbortError" });
  assert.equal((await readGeometryBinding(doc, send, () => true, controller.signal)).text, xyz);
  console.log("independent: before React import"); const { createRoot } = await import("react-dom/client");
  const { useGeometryBinding } = await import("../apps/desktop/src/hooks/use-geometry-binding");
  let identity: object = {}, enabled = true, seen!: ReturnType<typeof useGeometryBinding>;
  const seenState = (): ReturnType<typeof useGeometryBinding> => seen;
  const host = document.createElement("div"); document.body.append(host); const reactRoot = createRoot(host);
  function Reader(props: { identity: object; enabled: boolean }) { seen = useGeometryBinding(doc, send, props.identity, binding => binding.text === xyz, props.enabled); return null; }
  const render = async () => { await act(async () => { reactRoot.render(React.createElement(Reader, { identity, enabled })); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  try {
    console.log("hook step initial"); await render(); console.log("hook initial done", !!seenState().binding, seenState().error); assert.equal(seenState().binding?.text, xyz, "compiled hook publishes a real coherent binding");
    holdRead = true; const hookEntered = new Promise<void>(resolve => { readEntered = resolve; });
    const firstKey = seenState().key; identity = {}; console.log("hook held start"); await render(); console.log("hook held rendered",posts,bindingReads,seenState().key!==firstKey,!!seenState().binding, seenState().error); assert.equal(Boolean(seenState().binding), false, "compiled hook must retire the old binding immediately when model identity changes"); await hookEntered; console.log("hook held entered");
    assert.equal(seenState().binding, null, "new model cannot expose the previous model receipt while its read is pending");
    frame.remove(); frame = makeFrame(); identity = {}; await render();
    const newerBinding = seenState().binding; assert.ok(newerBinding); assert.equal(newerBinding.target.source, frame.contentWindow);
    await act(async () => { assert.ok(heldDelivery); (heldDelivery as () => void)(); heldDelivery = null; await Promise.resolve(); });
    assert.equal(seenState().binding, newerBinding, "old held ACK cannot overwrite a newer frame/model binding");
    enabled = false; await render(); assert.equal(seenState().binding, null); assert.equal(seenState().error, null);
    enabled = true; await render(); assert.ok(seenState().binding);
    const retained = seenState().binding; assert.ok(retained);
    const independentWriter = await readGeometryBinding(doc, send, () => true);
    assert.equal(claimGeometryPreview(doc.id, token, independentWriter.target.isCurrent), true);
    identity = {}; await render(); assert.equal(independentWriter.target.isCurrent(), true, "writer ownership is independent of the reader model identity"); assert.equal(seenState().binding, null);
    const beforeUnmount = posts; await act(async () => reactRoot.unmount()); releaseGeometryPreview(doc.id, token);
    await Promise.resolve(); assert.equal(posts, beforeUnmount, "unmounted idle waiter never sends a late read");
  } finally { await act(async () => reactRoot.unmount()); host.remove(); }
  // The persisted Geometry dock can mount before its new viewer has loaded any model.
  await plugin.clear();
  const loadingDocument = { ...doc, id: "binding-initial-load", path: "/initial-load.xyz" };
  frame.dataset.documentId = loadingDocument.id;
  let loadingIdentity = {};
  const loadingHost = document.createElement("div"); document.body.append(loadingHost);
  const loadingRoot = createRoot(loadingHost);
  const messageListeners = new Set<unknown>();
  const addMessage = dom.addEventListener, removeMessage = dom.removeEventListener;
  const addDescriptor = Object.getOwnPropertyDescriptor(dom, "addEventListener"), removeDescriptor = Object.getOwnPropertyDescriptor(dom, "removeEventListener");
  Object.defineProperty(dom, "addEventListener", { configurable: true, value: (...args: unknown[]) => {
    if (args[0] === "message") messageListeners.add(args[1]); return Reflect.apply(addMessage, dom, args);
  } });
  Object.defineProperty(dom, "removeEventListener", { configurable: true, value: (...args: unknown[]) => {
    if (args[0] === "message") messageListeners.delete(args[1]); return Reflect.apply(removeMessage, dom, args);
  } });
  let loadingSeen!: ReturnType<typeof useGeometryBinding>;
  const loadingState = () => loadingSeen;
  function LoadingReader() { loadingSeen = useGeometryBinding(loadingDocument, send, loadingIdentity, binding => binding.text === xyz); return null; }
  try {
    await act(async () => { loadingRoot.render(React.createElement(LoadingReader)); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(loadingState().binding, null); assert.ok(loadingState().error);
    const initialReads = bindingReads;
    const emitInitialReady = (eventSource: unknown = frame.contentWindow, body: Record<string, unknown> = { type: "ready", renderer: "molstar", documentId: loadingDocument.id }, source = "burette-viewer") => {
      dom.dispatchEvent(new dom.MessageEvent("message", { source: eventSource as typeof dom, data: { source, body } }));
    };
    await act(async () => {
      emitInitialReady(dom);
      emitInitialReady(frame.contentWindow, { type: "ready", documentId: "foreign" });
      emitInitialReady(frame.contentWindow, { type: "ready", renderer: "grid2d" });
      emitInitialReady(frame.contentWindow, { type: "ready" }, "forged-viewer");
      await Promise.resolve();
    });
    assert.equal(bindingReads, initialReads, "foreign ready messages cannot restart an unread model");
    const loadedRaw = await plugin.builders.data.rawData({ data: xyz });
    const loadedTrajectory = await plugin.builders.structure.parseTrajectory(loadedRaw, "xyz");
    const loadedModel = await plugin.builders.structure.createModel(loadedTrajectory); await plugin.builders.structure.createStructure(loadedModel);
    await act(async () => {
      dom.dispatchEvent(new dom.MessageEvent("message", { source: frame.contentWindow as unknown as typeof dom,
        data: { source: "burette-viewer", body: { type: "ready", renderer: "molstar", documentId: loadingDocument.id } } }));
      loadingRoot.render(React.createElement(LoadingReader)); await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(loadingState().binding?.text, xyz, "a mounted unread model recovers after its owning viewer finishes the initial load");
    const published = loadingState().binding, publishedReads = bindingReads;
    await act(async () => { emitInitialReady(); await Promise.resolve(); });
    assert.equal(bindingReads, publishedReads, "a published model never acquires another lease on later ready events");
    assert.equal(loadingState().binding, published);

    holdRead = true;
    const pendingRead = new Promise<void>(resolve => { readEntered = resolve; });
    loadingIdentity = {};
    await act(async () => { loadingRoot.render(React.createElement(LoadingReader)); await new Promise(resolve => setTimeout(resolve, 0)); });
    await pendingRead;
    const oldDelivery = heldDelivery; heldDelivery = null;
    await act(async () => { emitInitialReady(); await new Promise(resolve => setTimeout(resolve, 0)); });
    const readyBinding = loadingState().binding; assert.ok(readyBinding);
    await act(async () => { (oldDelivery as unknown as () => void)(); await Promise.resolve(); });
    assert.equal(loadingState().binding, readyBinding, "ready cancels a pending unread ACK; its late result cannot overwrite the new receipt");

    holdRead = true;
    const closingRead = new Promise<void>(resolve => { readEntered = resolve; }); loadingIdentity = {};
    await act(async () => { loadingRoot.render(React.createElement(LoadingReader)); await new Promise(resolve => setTimeout(resolve, 0)); });
    await closingRead;
    const closingDelivery = heldDelivery; heldDelivery = null;
    await act(async () => loadingRoot.unmount());
    const closedReads = bindingReads;
    emitInitialReady(); (closingDelivery as unknown as () => void)(); await Promise.resolve();
    assert.equal(bindingReads, closedReads, "unmount removes the owning-ready subscription and cancels the pending read");
    assert.equal(messageListeners.size, 0, "unmount removes both readiness and pending transport listeners");

    const { observeGeometryBinding } = await import("../apps/desktop/src/lib/geometry-binding-readiness");
    const received: unknown[] = [];
    holdRead = true;
    const replacingRead = new Promise<void>(resolve => { readEntered = resolve; });
    const stopFrame = observeGeometryBinding(loadingDocument, send, () => true, value => { received.push(value); }, () => {});
    await replacingRead;
    const replacedDelivery = heldDelivery; heldDelivery = null;
    const oldWindow = frame.contentWindow;
    frame.remove(); frame = makeFrame(); frame.dataset.documentId = loadingDocument.id;
    const replacementReads = bindingReads;
    emitInitialReady(oldWindow); emitInitialReady(); (replacedDelivery as unknown as () => void)(); await Promise.resolve();
    assert.equal(bindingReads, replacementReads, "ready cannot retarget a replaced same-id iframe");
    assert.equal(received.length, 0); stopFrame();

    holdRead = true;
    const restoringRead = new Promise<void>(resolve => { readEntered = resolve; });
    const stopSource = observeGeometryBinding(loadingDocument, send, () => true, value => { received.push(value); }, () => {});
    await restoringRead;
    const sourceDelivery = heldDelivery; heldDelivery = null;
    const sourceReads = bindingReads;
    beginScienceSessionRestore(loadingDocument.id);
    adoptLogicalSource({ documentId: loadingDocument.id, extension: "xyz", text: xyz }, "source-aba", null, ["O", "H", "H"]);
    emitInitialReady(); (sourceDelivery as unknown as () => void)(); await Promise.resolve();
    assert.equal(bindingReads, sourceReads, "same-text restore cannot restart a prior source owner's unread model");
    assert.equal(received.length, 0); stopSource();
    assert.equal(messageListeners.size, 0, "replaced source and frame observers leave no message subscriptions");
  } finally {
    await act(async () => loadingRoot.unmount()); loadingHost.remove();
    if (addDescriptor) Object.defineProperty(dom, "addEventListener", addDescriptor); else Reflect.deleteProperty(dom, "addEventListener");
    if (removeDescriptor) Object.defineProperty(dom, "removeEventListener", removeDescriptor); else Reflect.deleteProperty(dom, "removeEventListener");
  }
  console.log("Geometry binding: actual host bridge + MolStar baseline/lease, preview idle/recovery, ACK ABA, replacement, abort cleanup and pending restore guards passed.");
} finally {
  controller.abort(); releaseGeometryPreview(doc.id, token); frame?.remove(); plugin.dispose();
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  await dom.happyDOM.close();
}
