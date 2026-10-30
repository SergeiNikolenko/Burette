import { afterAll, mock } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useLayoutEffect } from "react";
import { parseXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ShellActions } from "../apps/desktop/src/components/types";

type KetcherExportFileRequest = Parameters<ShellActions["saveKetcherExportFile"]>[0];
const browser = new Window({ url: "http://localhost/" }), descriptors = new Map<string, PropertyDescriptor | undefined>();
const names = ["CSS", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "HTMLIFrameElement", "HTMLButtonElement", "HTMLDivElement", "Element", "Node", "NodeFilter", "DocumentFragment", "SVGElement", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const;
for (const [key, value] of Object.entries({ window: browser, ...Object.fromEntries(names.map(key => [key, browser[key]])), IS_REACT_ACT_ENVIRONMENT: true })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createRoot } = await import("react-dom/client");
const sourceText = await import("../apps/desktop/src/lib/structure-text");
export const files = new Map<string, string>();
mock.module("../apps/desktop/src/lib/structure-text", () => ({ ...sourceText,
  readStructureText: async (path: string) => { const text = files.get(path); if (text === undefined) throw new Error(`Unexpected file read ${path}`); return text; },
  readStructureTextDocument: async (path: string) => { const content = files.get(path); if (content === undefined) throw new Error(`Unexpected text read ${path}`); return { content, truncated: false, path, byteCount: new TextEncoder().encode(content).length }; },
}));
const browserDocuments = await import("../apps/desktop/src/lib/browser-dev-documents");
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments,
  openBrowserDevTextDocument: async ({ title, extension, text }: { title: string; extension: string; text: string }) => ({ id: "preview", title, extension, path: "/preview", byteCount: text.length, renderer: "molstar", runtimePath: "<html>preview</html>" }),
}));
const NativeWorker = Worker, originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
type HeldWorker = { worker: Worker; action: string; terminated: boolean; replies: (() => void)[] };
export const workers: HeldWorker[] = []; export let holdAction = "";
export const hold = (action: string) => { holdAction = action; };
Object.defineProperty(globalThis, "Worker", { ...originalWorker, value: new Proxy(NativeWorker, { construct(Target, args) {
  const worker = new Target(...args as ConstructorParameters<typeof NativeWorker>), own: HeldWorker = { worker, action: "", terminated: false, replies: [] }; workers.push(own);
  return new Proxy(worker, {
    set(target, key, value: unknown) {
      if (key === "onmessage" && typeof value === "function") {
        const receive = value as NonNullable<Worker["onmessage"]>;
        target.onmessage = event => { const deliver = () => receive.call(target, event); if (own.action === holdAction) own.replies.push(deliver); else deliver(); }; return true;
      }
      return Reflect.set(target, key, value);
    },
    get(target, key) {
      if (key === "postMessage") return (request: { action: string }) => { own.action = request.action; return target.postMessage(request); };
      if (key === "terminate") return () => { own.terminated = true; return target.terminate(); };
      const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    },
  });
} }) });
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
export const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
export const { adoptLogicalSource, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { PropertiesDialogBody } = await import("../apps/desktop/src/components/workbench/properties-dialog");
const { StructureEditPanel } = await import("../apps/desktop/src/components/workbench/structure-edit-panel");
const { Dialog, DialogContent } = await import("../apps/desktop/src/components/ui/dialog");
export const { toast } = await import("../apps/desktop/src/components/ui/toast");
export const ammonia = "4\nammonia\nN 0 0 0\nH .95 0 0\nH -.3 .9 0\nH -.3 -.45 .78\n";
export const water = "3\nwater\nO 0 0 0\nH .95 0 0\nH -.24 .93 0\n";
let serial = 0;
export const documentFor = (extension = "xyz"): ViewerDocument => ({ id: `properties-${++serial}`, title: `structure.${extension}`, path: `/structure-${serial}.${extension}`, extension, renderer: "molstar", runtimePath: "<html>scene</html>", byteCount: 0 });
export function logical(doc: ViewerDocument, text = water, extension: "xyz" | "sdf" = "xyz") {
  adoptLogicalSource({ documentId: doc.id, extension, text }, crypto.randomUUID(), null, extension === "sdf" ? ["C", "C", "O"] : parseXyz(text).atoms.map(atom => atom.element));
}
export async function until(predicate: () => unknown) { for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await Bun.sleep(10); }); if (!predicate()) throw new Error(`Timed out: ${document.body.textContent}`); }
export const button = (text: string, host: ParentNode = document.body) => { const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text || node.getAttribute("aria-label") === text); if (!result) throw new Error(`Missing button ${text}`); return result; };
export const click = (node: Element) => act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
export const formula = () => [...document.querySelectorAll("dt")].find(node => node.textContent === "Formula")?.nextElementSibling?.textContent;
export async function mount(doc = documentFor(), renderContent?: (document: ViewerDocument, actions: ShellActions) => React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const saved: KetcherExportFileRequest[] = [], opened: Parameters<ShellActions["openStructureRecords"]>[0][] = [], dock: string[] = [], layouts: { id: string; formula: string | null | undefined }[] = [];
  let controller!: ReturnType<typeof useSourceEditingController>, done = 0;
  const supplied: Partial<ShellActions> = {
    openDockTab: (_area: string, kind: string) => { dock.push(kind); },
    runStructureViewerAction: async () => {},
    saveKetcherExportFile: async (request: KetcherExportFileRequest) => { saved.push(request); return { status: "saved" as const, path: request.title }; },
    openStructureRecords: async (records: Parameters<ShellActions["openStructureRecords"]>[0]) => { opened.push(records); return []; },
  };
  const actions = new Proxy(supplied, { get(target, key) { if (key in target) return Reflect.get(target, key); return () => { throw new Error(`Unexpected shell action ${String(key)}`); }; } }) as ShellActions;
  function Frame({ document: current, edit }: { document: ViewerDocument; edit?: boolean }) {
    controller = useSourceEditingController({ activeDocument: current, preferences: defaultPreferences, pushErrorStatus: error => { throw error; }, setDockOpen() {}, setDockActiveTab() {} });
    useLayoutEffect(() => { layouts.push({ id: current.id, formula: formula() }); });
    return <SourceEditingProvider value={controller}>{renderContent ? renderContent(current, actions) : edit ? <StructureEditPanel document={current} actions={actions} /> : <Dialog open><DialogContent><PropertiesDialogBody document={current} actions={actions} onDone={() => { done++; }} /></DialogContent></Dialog>}</SourceEditingProvider>;
  }
  await act(async () => root.render(<Frame document={doc} />));
  return { host, doc, actions, saved, opened, dock, layouts, controller: () => controller, done: () => done,
    render: (current = doc, edit = false) => act(async () => root.render(<Frame document={current} edit={edit} />)),
    close: async () => { holdAction = ""; await act(async () => root.unmount()); for (const own of workers) own.worker.terminate(); releaseClosedScienceSessions(new Set()); files.clear(); host.remove(); },
  };
}
afterAll(async () => {
  Object.defineProperty(globalThis, "Worker", originalWorker);
  await browser.happyDOM.waitUntilComplete(); await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
