import { expect, mock, test } from "bun:test";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { zipSync, strToU8 } from "../apps/desktop/node_modules/fflate/esm/browser.js";
plugin({ name: "logical-sdf-compiler", setup(build) { build.onLoad({ filter: /hooks\/use-source-editing\.ts$/u }, ({ path }) => ({ contents: transformSync(readFileSync(path, "utf8"), {
  filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]],
})!.code!, loader: "ts" })); } });
const browser = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "MessageEvent", "CustomEvent", "MutationObserver", "localStorage", "CSS"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
let native = false;
const calls: [string, any][] = [];
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native, trackTauriListener: () => () => {} }));
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, body: any) => {
  calls.push([command, body]);
  if (command === "open_text_structure") return { id: "candidate", runtimePath: "<html>native candidate</html>" };
  throw new Error(`Unexpected archive file I/O: ${command}`);
} }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureText: async () => { throw new Error("Archive read as text"); }, readStructureTextDocument: async () => { throw new Error("Archive read as text"); } }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async (document: ViewerDocument) => document, useDeferredViewerRuntime: (document: ViewerDocument) => document }));
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { encodeScienceSession, decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
const { adoptLogicalSource, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const source = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8");
const edited = source.replace("$$$$", "> <EDIT_MARKER>\nchanged\n\n$$$$");
const binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 3 };
let serial = 0;
async function adopt(documentId: string, text = source) {
  const encoded = await encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: "sdf", text }, atomIds: null, binding, science: null, original: { name: "original.sdf", file: new Blob([text]) } });
  const archive = zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))), ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
  const decoded = (await decodeScienceSession(archive))!;
  // This is the validated registry input boundary; full host restore/binding is tested by its paired packet.
  adoptLogicalSource({ documentId, ...decoded.source }, decoded.documentUuid, decoded.atomIds, ["C", "C", "O"]);
  return decoded;
}
async function fixture() {
  const doc = { id: `logical-sdf-${++serial}`, path: `/Scenes/logical-${serial}.molx`, title: "Restored molecule.MOLX", extension: "molx", renderer: "molstar", runtimePath: "original scene" } as any;
  let controller!: ReturnType<typeof useSourceEditingController>;
  const errors: unknown[] = [], host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Probe() { controller = useSourceEditingController({ activeDocument: doc, preferences: { ...defaultPreferences, rendererMode: "molstar" } as any, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return null; }
  await act(async () => root.render(<Probe />));
  return { doc, errors, get controller() { return controller; }, async close() { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); native = false; } };
}
test("validated logical SDF opens without archive text I/O and stages an actual SDF browser runtime", async () => {
  const view = await fixture();
  try {
    const decoded = await adopt(view.doc.id);
    await act(async () => view.controller.beginEditing(view.doc));
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(decoded.source.text);
    expect(view.controller.sessionForDocument(view.doc)?.saveDisabledReason).toContain("Export → Scene");
    await act(async () => view.controller.updateDraft(view.doc, edited));
    expect(view.controller.sessionForDocument(view.doc)?.dirty).toBe(true);
    await act(async () => view.controller.applyPreview(view.doc));
    const session = view.controller.sessionForDocument(view.doc)!, snapshot = session.sourcePreview!;
    const staged = snapshot.slots[snapshot.activeSlot === "primary" ? "secondary" : "primary"]!;
    const config = JSON.parse(/window\.BuretteConfig = (.*);/u.exec(staged.runtimePath)![1]);
    expect([config.label, config.format, config.sourceExtension, config.viewerProfile, config.documentId]).toEqual(["Restored molecule.sdf", "sdf", "sdf", "structure", view.doc.id]);
    expect(snapshot.slots[snapshot.activeSlot]?.runtimePath).toBe("original scene");
    const before = calls.length; await act(async () => view.controller.save(view.doc));
    expect(calls.length).toBe(before); expect(view.errors).toEqual([]);
  } finally { await view.close(); }
});
test("logical SDF native preview uses the effective title/format and never opens or saves the archive as a source file", async () => {
  native = true; const view = await fixture(); const before = calls.length;
  try {
    await adopt(view.doc.id); await act(async () => view.controller.beginEditing(view.doc));
    await act(async () => view.controller.updateDraft(view.doc, edited));
    expect(view.controller.sessionForDocument(view.doc)?.dirty).toBe(true);
    await act(async () => view.controller.applyPreview(view.doc)); await act(async () => view.controller.save(view.doc));
    const actual = calls.slice(before);
    expect(actual.map(([command]) => command)).toEqual(["open_text_structure"]);
    expect(actual[0][1].request).toEqual({ title: "Restored molecule.sdf", extension: "sdf", text: edited });
    expect(view.errors).toEqual([]);
  } finally { await view.close(); }
});
test("a valid decoded multibyte SDF above the editing byte cap stays outside the editor", async () => {
  const view = await fixture();
  try {
    const text = source.replace("$$$$", `> <FOREIGN_TEXT>\n${"漢".repeat(1_000_000)}\n\n$$$$`);
    expect(text.length).toBeLessThan(2_000_000); expect(Buffer.byteLength(text)).toBeGreaterThan(3_000_000);
    await adopt(view.doc.id, text); await act(async () => view.controller.beginEditing(view.doc));
    expect(view.controller.sessionForDocument(view.doc) === null).toBe(true);
    expect((view.errors[0] as Error)?.message).toContain("3 MB");
  } finally { await view.close(); }
});
