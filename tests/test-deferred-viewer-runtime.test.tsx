import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument, ViewerPreferences } from "../apps/desktop/src/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let backend: (args: { paths: string[]; preferences: ViewerPreferences }) => Promise<unknown>;
const invoke = mock(async (_command: string, args: Parameters<typeof backend>[0]) => backend(args));
const abortClaims = mock(async () => {});
const core = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke }));
mock.module("../apps/desktop/src/lib/open-document-claims", () => ({ abortOpenDocumentClaims: abortClaims }));
const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useDeferredViewerRuntime, prepareDeferredViewerRuntime } = await import("../apps/desktop/src/hooks/use-deferred-viewer-runtime");
const preferences = { rendererMode: "xyzrender-external" } as ViewerPreferences;
const pending = (id: string): ViewerDocument => ({ id, path: `/${id}.pdb`, title: id, extension: "pdb", renderer: "molstar", runtimePath: "", byteCount: 10, runtimeDeferred: true, runtimeDeferredPreferences: { rendererMode: "auto" } });
const ready = (document: ViewerDocument): ViewerDocument => ({ ...document, runtimeDeferred: false, runtimePath: "/runtime/viewer.html", openClaimId: "claim" });
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function mount(document: ViewerDocument) {
  let result!: ReturnType<typeof useDeferredViewerRuntime>;
  function Hook() { result = useDeferredViewerRuntime(document, preferences); return null; }
  const node = globalThis.document.createElement("div"); globalThis.document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<Hook />));
  return { get result() { return result; }, async unmount() { await act(async () => root.unmount()); node.remove(); } };
}

test("two surfaces share one native preparation; closed queued surfaces do no parsing", async () => {
  const a = pending("a"), b = pending("b");
  useMoleculeStore.getState().setDocuments([a, b]); invoke.mockClear();
  let finish!: (value: unknown) => void;
  backend = () => new Promise((resolve) => { finish = resolve; });
  const first = await mount(a), duplicate = await mount(a), queued = await mount(b);
  expect(invoke).toHaveBeenCalledTimes(1);
  await first.unmount(); await queued.unmount();
  finish({ documents: [ready(a)], errors: [] }); await flush();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][1].preferences.rendererMode).toBe("auto");
  expect(useMoleculeStore.getState().documents[0].runtimePath).toBe("/runtime/viewer.html");
  expect(useMoleculeStore.getState().documents[1]).toBe(b);
  await duplicate.unmount();
});

test("closing an in-flight document releases its claim without resurrecting it", async () => {
  const document = pending("closed");
  useMoleculeStore.getState().setDocuments([document]); abortClaims.mockClear();
  let finish!: (value: unknown) => void;
  backend = () => new Promise((resolve) => { finish = resolve; });
  const surface = await mount(document);
  useMoleculeStore.getState().setDocuments([]);
  finish({ documents: [ready(document)], errors: [] }); await flush();
  expect(useMoleculeStore.getState().documents).toEqual([]);
  expect(abortClaims).toHaveBeenCalledWith([ready(document)]);
  await surface.unmount();
});

test("failed deferred preparation exposes retry and source editing awaits a real runtime", async () => {
  const document = pending("retry");
  useMoleculeStore.getState().setDocuments([document]);
  backend = async () => { throw new Error("source unavailable"); };
  const surface = await mount(document); await flush();
  expect(String(surface.result.error)).toContain("source unavailable");
  backend = async () => ({ documents: [ready(document)], errors: [] });
  await act(async () => surface.result.retry()); await flush();
  expect(surface.result.error).toBeNull();
  expect(useMoleculeStore.getState().documents[0].runtimeDeferred).toBeFalse();
  await surface.unmount();

  const source = pending("edit"); useMoleculeStore.getState().setDocuments([source]);
  backend = async () => ({ documents: [ready(source)], errors: [] });
  const prepared = await prepareDeferredViewerRuntime(source, preferences);
  expect(prepared.runtimePath).toBe("/runtime/viewer.html");
  expect(prepared.runtimeDeferred).toBeFalse();
});
