import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument } from "../apps/desktop/src/types";

plugin({ name: "source-recovery-compiler", setup(build) {
  build.onLoad({ filter: /(?:use-source-(?:editing|draft-recovery)\.ts|source-draft-recovery-dialog\.tsx|text-file-viewer\.tsx|source-editing\/context\.tsx)$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "tsx",
  }));
} });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "DocumentFragment", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "MutationObserver", "ResizeObserver", "CSS", "localStorage"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
}
for (const [key, value] of Object.entries({ window: browser, getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser), cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
}
let native = false, destination: () => Promise<string | null> = async () => "/recovered/source.sdf";
let write: () => Promise<string> = async () => "/recovered/source.sdf";
const writes: { command: string; args: Record<string, unknown> }[] = [], choices: Record<string, unknown>[] = [];
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async (document: ViewerDocument) => document }));
mock.module("@tauri-apps/plugin-dialog", () => ({ save: async (options: Record<string, unknown>) => { choices.push(options); return destination(); }, confirm: async () => false, message: async () => {} }));
const core = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke: async (command: string, args: Record<string, unknown>) => { writes.push({ command, args }); if (command === "save_text_as") return write(); } }));
const downloads: { blob: Blob; name: string | null }[] = [];
const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL, anchorClick = browser.HTMLAnchorElement.prototype.click;
URL.createObjectURL = blob => { if (!(blob instanceof Blob)) throw new Error("Expected text Blob"); downloads.push({ blob, name: null }); return "blob:source-recovery"; }; URL.revokeObjectURL = () => {};
browser.HTMLAnchorElement.prototype.click = function () { downloads.at(-1)!.name = this.download; };
afterAll(async () => {
  URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL; browser.HTMLAnchorElement.prototype.click = anchorClick;
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  await browser.happyDOM.close();
});
const { createRoot } = await import("react-dom/client");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { TextFileViewer } = await import("../apps/desktop/src/components/text-file-viewer");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { adoptLogicalSource, logicalSourceFor, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const source = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8");
const draft = source.replace(/^[^\n]*\n/u, "Recovered é draft\r\n");
const displayedDraft = draft.replace(/\r\n?/gu, "\n");
const restored = source.replace(/^[^\n]*\n/u, "Scene B\n");
let serial = 0;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === label)!;
const click = async (label: string) => { const target = button(label); expect(target).toBeDefined(); await act(async () => target.click()); };
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
async function fixture() {
  writes.length = 0; choices.length = 0; downloads.length = 0;
  destination = async () => "/recovered/source.sdf"; write = async () => "/recovered/source.sdf";
  const doc = { id: `source-recovery-${++serial}`, path: `/scene-${serial}.molx`, title: "scene.molx", extension: "molx", renderer: "molstar", runtimePath: "scene" } as ViewerDocument;
  adoptLogicalSource({ documentId: doc.id, extension: "sdf", text: source }, crypto.randomUUID(), null, ["C", "C", "O"]);
  let controller!: ReturnType<typeof useSourceEditingController>;
  const errors: unknown[] = [], host = document.createElement("div"); host.className = "app-shell"; document.body.append(host); const root = createRoot(host);
  function Fixture() {
    controller = useSourceEditingController({ activeDocument: doc, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} });
    return <SourceEditingProvider value={controller}><TextFileViewer document={{ ...doc, extension: "sdf", language: "sdf", content: restored, truncated: false, byteCount: restored.length }} sourceEditing={{
      editable: false, content: restored, dirty: false, saving: false, status: "Read Only", onBeginEditing: () => { void controller.beginEditing(doc); },
    }} /></SourceEditingProvider>;
  }
  await act(async () => root.render(<Fixture />));
  await act(async () => controller.beginEditing(doc));
  await act(async () => controller.updateDraft(doc, draft, { previewApplied: true }));
  const old = controller.sessionForDocument(doc)!;
  await act(async () => adoptLogicalSource({ documentId: doc.id, extension: "sdf", text: restored }, crypto.randomUUID(), null, ["C", "C", "O"]));
  return { doc, old, errors, get controller() { return controller; }, close: async () => { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); } };
}

test("compiled Edit source recovers retired bytes read-only and browser Save copy preserves the restored scene", async () => {
  native = false; const v = await fixture();
  try {
    const owner = logicalSourceFor(v.doc.id);
    expect(v.controller.sessionForDocument(v.doc)).toBeNull();
    await click("Edit source");
    const text = document.querySelector<HTMLTextAreaElement>('[aria-label="Unsaved source contents"]')!;
    expect([text.readOnly, text.value.replace(/\r\n?/gu, "\n"), document.querySelectorAll('[role="dialog"]').length]).toEqual([true, displayedDraft, 1]);
    await click("Save copy"); await flush();
    expect([downloads[0].name, await downloads[0].blob.text()]).toEqual(["scene.sdf", draft]);
    expect([logicalSourceFor(v.doc.id) === owner, v.controller.sessionForDocument(v.doc), writes.filter(value => value.command === "save_source_document")]).toEqual([true, null, []]);
    await click("Edit source");
    expect(document.querySelector<HTMLTextAreaElement>("textarea[readonly]")!.value.replace(/\r\n?/gu, "\n")).toBe(displayedDraft);
    await click("Cancel"); expect(v.controller.hasUnsavedOrSavingSessions).toBe(true);
  } finally { await v.close(); }
});

test("Close Cancel, failed and cancelled native copies retain the exact retired draft for retry", async () => {
  native = true; const v = await fixture();
  try {
    let close!: Promise<boolean>; await act(async () => { close = v.controller.closeDocuments([v.doc.id]); });
    await click("Cancel"); expect(await close).toBe(false);
    await click("Edit source"); destination = async () => null;
    await click("Save copy"); await flush();
    expect([document.querySelector<HTMLTextAreaElement>("textarea[readonly]")!.value.replace(/\r\n?/gu, "\n"), writes.length]).toEqual([displayedDraft, 0]);
    destination = async () => "/recovered/source.sdf"; write = async () => { throw new Error("disk unavailable"); };
    await click("Save copy"); await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(document.querySelector<HTMLTextAreaElement>("textarea[readonly]")!.value.replace(/\r\n?/gu, "\n")).toBe(displayedDraft);
    write = async () => "/recovered/source.sdf"; await click("Save copy"); await flush();
    const copy = writes.filter(value => value.command === "save_text_as").at(-1)!;
    expect(copy.args).toEqual({ text: draft, outputPath: "/recovered/source.sdf", sourcePath: null });
    expect(v.controller.hasUnsavedOrSavingSessions).toBe(true);
    expect(choices.at(-1)?.defaultPath).toBe("scene.sdf");
  } finally { await v.close(); }
});

test("late native destination cannot write or close a later recovery request for scene C", async () => {
  native = true; const v = await fixture();
  try {
    let release!: (path: string) => void; destination = () => new Promise(resolve => { release = resolve; });
    await click("Edit source"); const before = v.controller.recovery!;
    await click("Save copy"); expect(button("Save copy").disabled).toBe(true);
    await act(async () => adoptLogicalSource({ documentId: v.doc.id, extension: "sdf", text: restored.replace("Scene B", "Scene C") }, crypto.randomUUID(), null, ["C", "C", "O"]));
    await click("Edit source"); const later = v.controller.recovery!;
    expect(later.requestId).not.toBe(before.requestId);
    await act(async () => release("/recovered/stale.sdf")); await flush();
    expect([writes.filter(value => value.command === "save_text_as"), v.controller.recovery?.requestId, logicalSourceFor(v.doc.id)?.text]).toEqual([[], later.requestId, restored.replace("Scene B", "Scene C")]);
    await click("Cancel"); expect(v.controller.hasUnsavedOrSavingSessions).toBe(true);
  } finally { await v.close(); }
});


test("window recovery Discard releases only the retired draft and Edit source starts from scene B", async () => {
  native = false; const v = await fixture();
  try {
    const owner = logicalSourceFor(v.doc.id);
    let closing!: Promise<boolean>; await act(async () => { closing = v.controller.confirmCloseWindow(); });
    await click("Cancel"); expect(await closing).toBe(false);
    await act(async () => { closing = v.controller.confirmCloseWindow(); });
    await click("Discard"); expect(await closing).toBe(false);
    expect([logicalSourceFor(v.doc.id) === owner, v.controller.hasUnsavedOrSavingSessions, writes]).toEqual([true, false, []]);
    await click("Edit source");
    expect([v.controller.recovery, v.controller.sessionForDocument(v.doc)?.content, v.controller.sessionForDocument(v.doc)?.dirty]).toEqual([null, restored, false]);
  } finally { await v.close(); }
});

test("choosing the original destination refuses writes and preserves the recoverable text", async () => {
  native = true; const v = await fixture();
  try {
    destination = async () => v.doc.path;
    await click("Edit source"); await click("Save copy"); await flush();
    expect([writes, v.controller.recovery?.drafts[0].content, v.controller.hasUnsavedOrSavingSessions]).toEqual([[], draft, true]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    await click("Cancel"); expect(v.controller.hasUnsavedOrSavingSessions).toBe(true);
  } finally { await v.close(); }
});

test("a completed old native copy cannot dismiss a later request or close scene C", async () => {
  native = true; const v = await fixture();
  try {
    let complete!: (path: string) => void; destination = async () => "/recovered/held.sdf";
    write = () => new Promise(resolve => { complete = resolve; });
    let closing!: Promise<boolean>; await act(async () => { closing = v.controller.closeDocuments([v.doc.id]); });
    await click("Save copy"); expect(writes.filter(value => value.command === "save_text_as")).toHaveLength(1);
    const c = restored.replace("Scene B", "Scene C");
    await act(async () => adoptLogicalSource({ documentId: v.doc.id, extension: "sdf", text: c }, crypto.randomUUID(), null, ["C", "C", "O"]));
    expect(await closing).toBe(false);
    await click("Edit source"); const latest = v.controller.recovery!;
    await act(async () => complete("/recovered/held.sdf")); await flush();
    expect([v.controller.recovery?.requestId, logicalSourceFor(v.doc.id)?.text, button("Save copy").disabled]).toEqual([latest.requestId, c, false]);
    expect(writes.map(value => value.command)).toEqual(["save_text_as"]);
    await click("Discard"); await click("Edit source");
    expect([v.controller.sessionForDocument(v.doc)?.content, logicalSourceFor(v.doc.id)?.text]).toEqual([c, c]);
  } finally { await v.close(); }
});


test("multiple retired documents preview and copy the selected draft without discarding either", async () => {
  native = true; const v = await fixture();
  try {
    const other = { ...v.doc, id: `${v.doc.id}-other`, path: "/other.molx", title: "other.molx" };
    const otherDraft = draft.replace("Recovered é draft", "Other draft");
    await act(async () => adoptLogicalSource({ documentId: other.id, extension: "sdf", text: source }, crypto.randomUUID(), null, ["C", "C", "O"]));
    await act(async () => v.controller.beginEditing(other));
    await act(async () => v.controller.updateDraft(other, otherDraft, { previewApplied: true }));
    await act(async () => adoptLogicalSource({ documentId: other.id, extension: "sdf", text: restored }, crypto.randomUUID(), null, ["C", "C", "O"]));
    let closing!: Promise<boolean>; await act(async () => { closing = v.controller.closeDocuments([v.doc.id, other.id]); });
    const selected = v.controller.recovery!.drafts.find(value => value.documentId === other.id)!;
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Unsaved source draft"]')!;
    await act(async () => { select.value = selected.sessionId; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(document.querySelector<HTMLTextAreaElement>("textarea[readonly]")!.value.replace(/\r\n?/gu, "\n")).toBe(otherDraft.replace(/\r\n?/gu, "\n"));
    await click("Save copy"); await flush(); expect(await closing).toBe(false);
    expect(writes.filter(value => value.command === "save_text_as").map(value => value.args)).toEqual([{ text: otherDraft, outputPath: "/recovered/source.sdf", sourcePath: null }]);
    await click("Edit source"); expect(v.controller.recovery?.drafts.map(value => value.content)).toEqual([draft]);
    await click("Discard"); expect(v.controller.hasUnsavedOrSavingSessions).toBe(true);
    await act(async () => { void v.controller.beginEditing(other); });
    expect(v.controller.recovery?.drafts.map(value => value.content)).toEqual([otherDraft]);
    await click("Cancel");
  } finally { await v.close(); }
});


test("unmounting during a native destination picker cannot write the old draft later", async () => {
  native = true; const v = await fixture(); let closed = false;
  try {
    let release!: (path: string) => void; destination = () => new Promise(resolve => { release = resolve; });
    await click("Edit source"); await click("Save copy");
    await v.close(); closed = true;
    await act(async () => release("/recovered/closed.sdf")); await flush();
    expect(writes.filter(value => value.command === "save_text_as")).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally { if (!closed) await v.close(); }
});
