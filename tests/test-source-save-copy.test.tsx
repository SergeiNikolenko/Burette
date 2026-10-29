import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
}
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
const source = "1\noriginal\nC 0 0 0\n";
const doc: ViewerDocument = { byteCount: source.length, id: "copy", title: "molecule.xyz", path: "/original.xyz", extension: "xyz", renderer: "molstar", runtimePath: "<html>scene</html>" };
let native = false;
const commands: { command: string; args: Record<string, unknown> }[] = [], downloads: { blob: Blob; name: string | null }[] = [];
const revision = { modifiedAt: 1, byteCount: source.length, contentHash: "original" };
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureTextDocument: async () => ({ content: source, truncated: false }) }));
const browserDocuments = await import("../apps/desktop/src/lib/browser-dev-documents");
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments, openBrowserDevTextDocument: async () => doc }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async (document: ViewerDocument) => document }));
const core = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke: async (command: string, args: Record<string, unknown>) => {
  commands.push({ command, args });
  return command === "open_source_edit_session" ? { handleId: "native-handle", content: source, revision, previewMode: "live" } : { revision: { ...revision, contentHash: "saved" } };
} }));
// Keep the real download helper; intercept only the browser's download boundary.
URL.createObjectURL = blob => { if (!(blob instanceof Blob)) throw new Error("Expected downloaded Blob"); downloads.push({ blob, name: null }); return "blob:copy-test"; };
URL.revokeObjectURL = () => {};
browser.HTMLAnchorElement.prototype.click = function () { downloads.at(-1)!.name = this.download; };
const { createRoot } = await import("react-dom/client");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { adoptLogicalSource, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
async function fixture(document: ViewerDocument = doc) {
  let controller!: ReturnType<typeof useSourceEditingController>;
  const errors: unknown[] = [];
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host as unknown as HTMLElement);
  function Fixture() { controller = useSourceEditingController({ activeDocument: document, preferences: defaultPreferences, pushErrorStatus: (error: unknown) => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return null; }
  await act(async () => root.render(<Fixture />));
  await act(async () => controller.beginEditing(document));
  return { get controller() { return controller; }, errors, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test("browser Save copy downloads the newest bounded draft and preserves original dirty state", async () => {
  native = false; commands.length = 0; downloads.length = 0;
  const view = await fixture();
  try {
    expect(view.controller.sessionForDocument(doc)!.saveLabel).toBe("Save copy");
    expect(view.controller.sessionForDocument(doc)!.saveDisabledReason).toBeNull();
    await act(async () => view.controller.updateDraft(doc, source.replace("original", "older"), { previewApplied: true }));
    const newest = source.replace("original", "newest");
    await act(async () => view.controller.updateDraft(doc, newest, { previewApplied: true }));
    await act(async () => view.controller.save(doc));
    expect(downloads[0].name).toBe("molecule.xyz");
    expect(await downloads[0].blob.text()).toBe(newest);
    const session = view.controller.sessionForDocument(doc)!;
    expect([session.content, session.baseContent, session.dirty, session.saving]).toEqual([newest, source, true, false]);
    expect(commands).toEqual([]);
    await act(async () => view.controller.updateDraft(doc, "x".repeat(3_000_001), { previewApplied: true }));
    await act(async () => view.controller.save(doc));
    expect(downloads.length).toBe(1);
    expect(view.controller.sessionForDocument(doc)!.diagnostic).toContain("3 MB");
  } finally { await view.close(); }
});

test("native Save still writes the original handle and marks only its saved revision clean", async () => {
  native = true; commands.length = 0; downloads.length = 0;
  const view = await fixture();
  try {
    const changed = source.replace("original", "native");
    expect(view.controller.sessionForDocument(doc)!.saveLabel).toBe("Save");
    await act(async () => view.controller.updateDraft(doc, changed, { previewApplied: true }));
    await act(async () => view.controller.save(doc));
    expect(commands.find(item => item.command === "save_source_document")!.args.request).toEqual({ handleId: "native-handle", content: changed, expectedRevision: revision, overwriteConfirmedRevision: null });
    expect(view.controller.sessionForDocument(doc)!.dirty).toBe(false);
    expect(downloads).toEqual([]);
  } finally { await view.close(); native = false; }
});


test("download failure retains the draft and exposes a retryable diagnostic", async () => {
  native = false; downloads.length = 0; const view = await fixture();
  const createObjectURL = URL.createObjectURL;
  try {
    const changed = source.replace("original", "retry");
    await act(async () => view.controller.updateDraft(doc, changed, { previewApplied: true }));
    URL.createObjectURL = () => { throw new Error("Download unavailable"); };
    await act(async () => view.controller.save(doc));
    expect(view.controller.sessionForDocument(doc)!.diagnostic).toContain("Try Save copy again");
    expect([view.controller.sessionForDocument(doc)!.baseContent, view.controller.sessionForDocument(doc)!.dirty]).toEqual([source, true]);
    URL.createObjectURL = createObjectURL;
    await act(async () => view.controller.save(doc));
    expect(await downloads[0].blob.text()).toBe(changed);
    expect(view.controller.sessionForDocument(doc)!.diagnostic).toBeNull();
    expect(view.controller.sessionForDocument(doc)!.dirty).toBe(true);
    await act(async () => view.controller.updateDraft(doc, "not an XYZ structure"));
    await act(async () => view.controller.applyPreview(doc));
    const diagnostic = view.controller.sessionForDocument(doc)!.diagnostic;
    expect(diagnostic).toContain("invalid atom count");
    await act(async () => view.controller.save(doc));
    expect(view.controller.sessionForDocument(doc)!.diagnostic).toBe(diagnostic);
  } finally { URL.createObjectURL = createObjectURL; await view.close(); }
});

test("a restored logical SDF stays saved with its scene in both browser and native sessions", async () => {
  const text = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8");
  for (const platform of [false, true]) {
    native = platform; downloads.length = 0; commands.length = 0;
    const scene: ViewerDocument = { ...doc, id: `logical-copy-${platform}`, path: `/Scenes/logical-copy-${platform}.molx`, title: "scene.molx", extension: "molx" };
    adoptLogicalSource({ documentId: scene.id, extension: "sdf", text }, crypto.randomUUID(), null, ["C", "C", "O"]);
    const view = await fixture(scene);
    try {
      await act(async () => view.controller.updateDraft(scene, text.replace("$$$$", "> <EDIT>\nkept\n\n$$$$"), { previewApplied: true }));
      expect(view.controller.sessionForDocument(scene)!.saveDisabledReason).toBe("Saved with the scene: Export → Scene");
      await act(async () => view.controller.save(scene));
      expect([downloads, commands]).toEqual([[], []]);
      expect(view.controller.sessionForDocument(scene)!.dirty).toBe(true);
    } finally { await view.close(); releaseClosedScienceSessions(new Set()); }
  }
  native = false;
});
