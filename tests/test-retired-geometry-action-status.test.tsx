import { afterAll, expect, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
plugin({ name: "host-status-compiler", setup(build) {
  build.onLoad({ filter: /use-app-viewer-(?:host|bridge)-messages\.ts$/u }, ({ path }) => {
    const code = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!;
    process.stderr.write(JSON.stringify({ module: path.split("/").pop(), cacheEmitted: code.includes("react/compiler-runtime") }) + "\n");
    return { contents: code, loader: "ts" };
  });
} });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, CSS: browser.CSS,
  MessageEvent: browser.MessageEvent, getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import("react-dom/client");
const { useAppViewerHostMessages } = await import("../apps/desktop/src/hooks/use-app-viewer-host-messages");
const { useAppViewerBridgeMessages } = await import("../apps/desktop/src/hooks/use-app-viewer-bridge-messages");
const { requestViewerAction, isKnownViewerMessageSource } = await import("../apps/desktop/src/lib/viewer-bridge");
const failure = { ok: false, command: "geometry_binding", error: { code: "ACTION_ERROR", message: "The Geometry source or viewer changed." } };
let serial = 0;
async function fixture(mountFirst = true, deferHost = false) {
  const id = `retired-${++serial}`, host = document.createElement("div"); document.body.append(host);
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = id; host.append(frame);
  const source = frame.contentWindow!, sent: { body: { id: string } }[] = [], statuses: unknown[] = []; let dismissals = 0;
  source.postMessage = value => sent.push(value);
  const rootElement = document.createElement("div"); host.append(rootElement); const root = createRoot(rootElement);
  const no = () => false;
  function Probe() {
    const { handleViewerHostMessage } = useAppViewerHostMessages({ pendingMolstarReplaceRef: { current: new Map() },
      pushStatus: (message, kind, details) => { statuses.push({ message, kind, details }); return () => { dismissals++; }; } });
    useAppViewerBridgeMessages({ handleViewerHostMessage: (...args: Parameters<typeof handleViewerHostMessage>) => {
      if (deferHost) { queueMicrotask(() => handleViewerHostMessage(...args)); return true; }
      return handleViewerHostMessage(...args);
    }, isKnownViewerMessageSource,
      handleDockingPoseMessage: no, handleGridConformerMessage: no, handleGridComputeMessage: no,
      handleGridControlMessage: no, handleGridFileMessage: no, handleGridRuntimeMessage: no,
      handleKetcherViewerMessage: no, handleMolstarContextMessage: no, handlePubChemSearchMessage: no,
      handleRendererMessage: no, handleSdfViewerMessage: async () => false, handleViewerConformerMessage: no,
      handleViewerFileMessage: no, handleViewerRuntimeFileMessage: no, handleViewerRuntimeMessage: no,
      handleViewerStateMessage: no, handleXyzrenderSheetMessage: no, markViewerFirstRenderMessage() {} }); return null;
  }
  const mount = () => act(async () => { root.render(<Probe />); });
  if (mountFirst) await mount();
  const reply = (requestId: string, result = failure, from = source) => window.dispatchEvent(new MessageEvent("message", {
    source: from, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: requestId, result } },
  }));
  const send = (signal?: AbortSignal, action = "geometry_binding", timeoutMs = 2000) => requestViewerAction(id, { type: action }, timeoutMs, signal)
    .then(value => ({ value, error: "" }), error => ({ value: null, error: error.message as string }));
  return { frame, host, source, sent, statuses, send, mount, reply, dismissed: () => dismissals,
    close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
test("retired source failure is not a global status, regardless of ACK listener order", async () => {
  for (const [first, deferHost] of [[true, false], [false, false], [false, true]]) {
    const f = await fixture(first, deferHost);
    try { const pending = f.send(); if (!first) await f.mount(); f.frame.dataset.sourcePreviewRevision = "new-owner";
      f.reply(f.sent[0].body.id); expect((await pending).error).toBe("The viewer changed before the response arrived.");
      expect(f.statuses).toEqual([]);
    } finally { await f.close(); }
  }
});
test("abort removes local request but its matching late failure remains retired", async () => {
  const f = await fixture();
  try { const abort = new AbortController(), pending = f.send(abort.signal); abort.abort();
    expect((await pending).error).toContain("cancelled"); f.reply(f.sent[0].body.id);
    await Promise.resolve(); expect(f.statuses).toEqual([]);
  } finally { await f.close(); }
});
test("current and unknown failures remain visible and a retired success cannot dismiss them", async () => {
  const f = await fixture();
  try { const old = f.send(), current = f.send(); f.reply(f.sent[1].body.id);
    expect((await current).error).toBe(failure.error.message); expect(f.statuses).toHaveLength(1);
    f.frame.dataset.sourcePreviewRevision = "replaced"; f.reply(f.sent[0].body.id, { ok: true, command: "geometry_binding" } as typeof failure);
    expect((await old).error).toContain("viewer changed"); expect(f.dismissed()).toBe(0);
    f.reply("unknown-request"); expect(f.statuses).toHaveLength(2);
  } finally { await f.close(); }
});
test("other commands and a different known frame cannot inherit a geometry request retirement", async () => {
  const f = await fixture();
  try { const abort = new AbortController(), pending = f.send(abort.signal); abort.abort(); await pending;
    const other = document.createElement("iframe"); other.className = "viewer-iframe"; other.dataset.documentId = "other"; f.host.append(other);
    f.reply(f.sent[0].body.id, failure, other.contentWindow!); expect(f.statuses).toHaveLength(1);
    f.reply(f.sent[0].body.id); expect(f.statuses).toHaveLength(1);
    const unrelated = f.send(undefined, "set_structure_pose"); f.frame.dataset.sourcePreviewRevision = "changed";
    f.reply(f.sent[1].body.id); await unrelated; expect(f.statuses).toHaveLength(2);
  } finally { await f.close(); }
});


test("retained cancellations expire and their finite inventory cannot suppress unknown replies", async () => {
  const f = await fixture();
  try {
    const abort = new AbortController(), expired = f.send(abort.signal, "geometry_binding", 1); abort.abort(); await expired;
    await new Promise(resolve => setTimeout(resolve, 10)); f.reply(f.sent[0].body.id);
    expect(f.statuses).toHaveLength(1);
    const first = f.sent.length;
    for (let n=0; n<257; n++) { const stop=new AbortController(), pending=f.send(stop.signal); stop.abort(); await pending; }
    f.reply(f.sent[first].body.id); expect(f.statuses).toHaveLength(2);
    f.reply(f.sent.at(-1)!.body.id); expect(f.statuses).toHaveLength(2);
  } finally { await f.close(); }
});
