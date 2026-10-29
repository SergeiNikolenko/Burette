import { expect, mock } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ViewerDocument, ViewerPreferences } from "../apps/desktop/src/types";
import { graphDraftText } from "../apps/desktop/src/lib/workbench/graph-draft";
import { patchGraphMetadata } from "../apps/desktop/src/lib/workbench/graph-metadata";

plugin({ name: "measurement-pair-publication-compiler", setup(build) {
  build.onLoad({ filter: /(?:components|lib)\/workbench\/use-graph-draft\.ts$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "ts",
  }));
} });
export const browser = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
}
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
const source = ["Pair publication", "Burette", "", "  3  2  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    2.0000    1.3000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0  0  0  0", "  2  3  1  0  0  0  0", "M  END", "$$$$", ""].join("\n");
const sourceFor = (path: string) => path.endsWith(".mol") ? source.replace("$$$$\n", "") : source;
export const holds: { read: boolean; graph: boolean; releaseRead: (() => void) | null; releaseWorker: (() => void) | null } = { read: false, graph: false, releaseRead: null, releaseWorker: null };
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: async (path: string) => sourceFor(path),
  readStructureTextDocument: async (path: string) => {
    if (holds.read) { holds.read = false; await new Promise<void>(resolve => { holds.releaseRead = resolve; }); }
    return { content: sourceFor(path), truncated: false };
  },
}));
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({
  isBrowserDraftSource: () => false,
  openBrowserDevTextDocument: async () => { throw new Error("Preview was not requested in this test."); },
}));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async (document: ViewerDocument) => document }));
mock.module("../apps/desktop/src/lib/workbench/selection", () => ({ forgetViewerAtomSelection() {} }));
const NativeWorker = globalThis.Worker;
class HeldWorker extends NativeWorker {
  postMessage(request: unknown) {
    if (holds.graph && request && typeof request === "object" && "action" in request && request.action === "edit-graph") { holds.graph = false; holds.releaseWorker = () => super.postMessage(request); }
    else super.postMessage(request);
  }
}
globalThis.Worker = HeldWorker;
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { useGraphDraft: useFocusedGraphDraft } = await import("../apps/desktop/src/lib/workbench/use-graph-draft");
let serial = 0;
export async function fixture(format: "sdf" | "mol" = "sdf", useAdapter: typeof useFocusedGraphDraft = useFocusedGraphDraft) {
  const doc = { id: `pair-publication-${++serial}`, path: `/pair-publication-${serial}.${format}`, title: `source.${format}`,
    extension: format, renderer: "molstar", runtimePath: "<html>scene</html>" } as ViewerDocument;
  let controller!: ReturnType<typeof useSourceEditingController>, graph!: ReturnType<typeof useFocusedGraphDraft>, focused!: ReturnType<typeof useFocusedGraphDraft>;
  let writeMode: "normal" | "throw" | "noop" = "normal";
  let afterWrite: (() => void) | undefined;
  const dockTabs: string[] = [];
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Probe() { graph = useAdapter(doc); focused = useFocusedGraphDraft(doc); return null; }
  function Fixture() {
    controller = useSourceEditingController({ activeDocument: doc, preferences: {} as ViewerPreferences,
      pushErrorStatus() {}, setDockOpen() {}, setDockActiveTab(_side, tab) { dockTabs.push(tab); } });
    return <SourceEditingProvider value={{ ...controller, updateDraft(document, content, options) {
      if (writeMode === "throw") throw new Error("Draft write rejected.");
      if (writeMode === "noop") return;
      controller.updateDraft(document, content, options); if (afterWrite) queueMicrotask(afterWrite);
    } }}><Probe /></SourceEditingProvider>;
  }
  const settle = async (ready: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !ready(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(ready()).toBe(true);
  };
  await act(async () => root.render(<Fixture />)); await settle(() => !graph.loading);
  expect(graph.error).toBeNull(); expect(graph.history).not.toBeNull();
  expect(focused.history).toBe(graph.history);
  return { doc, dockTabs, get controller() { return controller; }, get graph() { return graph; }, get focused() { return focused; }, settle,
    setWriteMode(mode: typeof writeMode) { writeMode = mode; }, afterWrite(probe: () => void) { afterWrite = probe; },
    edit(label: string) {
      const from = graph.history!.current, patch = { conformerLabel: label };
      return { operation: { kind: "metadata" as const, from, patch }, target: graphDraftText(graph.history!.origin, "sdf", from.structure.molfile, patchGraphMetadata(from.metadata!, patch)) };
    },
    async apply(operation: Parameters<typeof graph.apply>[0], options?: Parameters<typeof graph.apply>[1]) {
      let result: Awaited<ReturnType<typeof graph.apply>> = null; await act(async () => { result = await graph.apply(operation, options); }); return result;
    },
    close: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}
