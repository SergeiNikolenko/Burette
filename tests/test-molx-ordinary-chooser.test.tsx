import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { plugin as installPlugin } from "bun";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {zipSync, unzipSync} from "../apps/desktop/node_modules/fflate";
import React, { act } from "react";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import type { UUID } from "molstar/lib/mol-util/uuid.js";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ScienceSessionContent } from "../apps/desktop/src/lib/science-session/codec";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import { molstarMolV3000Plugin } from "../scripts/molstar-mol-v3000.mjs";
import { molstarV3000ChargesPlugin } from "../scripts/molstar-v3000-charges.mjs";
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
Object.assign(browser, { setImmediate, clearImmediate });
for (const [key, value] of Object.entries({ window: browser, self: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  localStorage: browser.localStorage, indexedDB: new IDBFactory(), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } });
installPlugin(molstarMolV3000Plugin); installPlugin(molstarV3000ChargesPlugin);
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
const { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useAppOpenActions } = await import("../apps/desktop/src/hooks/use-app-open-actions");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { detectContentSpectrumPaths } = await import("../apps/desktop/src/lib/content-spectrum-detection");
const { readBrowserImport, saveBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
const { readBrowserDevVirtualTextDocument, openBrowserDevDocuments } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { readSceneDocumentBytes } = await import("../apps/desktop/src/lib/science-session/source-bytes");
const { readCjsonGraph } = await import("../apps/desktop/src/lib/molecular-workbench/cjson-graph");
const { readOrcaMcdBlocks } = await import("../apps/desktop/src/lib/molecular-workbench/orca-circular-spectra");
const { encodeScienceSession, decodeScienceSession, sha256Hex } = await import("../apps/desktop/src/lib/science-session/codec");
const { restoreScienceSession, isScienceSessionCandidate } = await import("../apps/desktop/src/lib/science-session/restore");
const { scientificStateFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { releaseClosedScienceSessions, logicalSourceFor } = await import("../apps/desktop/src/lib/science-session/state");
const runtime: Record<string, any> = {};
vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/scene-file-actions.js", import.meta.url), "utf8"), { window: runtime, crypto, TextEncoder, TextDecoder, Set, WeakMap, File, Uint8Array, Float64Array });
const scene = runtime.BuretteSceneFiles.science, baseline = useMoleculeStore.getState().documents;
afterEach(() => { useMoleculeStore.setState({ documents: baseline }); releaseClosedImports(new Set(baseline.map(doc => doc.id))); releaseClosedScienceSessions(new Set()); });

async function archive(version: 1 | 3 | 4 | "plain" | "mesoscale") {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  try {
    let text = "1\nfixture\nH 0 0 0\n", extension: "xyz" | "mol" = "xyz", original = new Blob(["authored primary"]);
    const atoms = [{ element: "H", x: 0, y: 0, z: 0 }];
    let science: ScientificDocument = { format: "xyz", atoms, frames: [{ atoms }], modes: [], orbitals: [] };
    if (version === 4) {
      const input = readFileSync(new URL("./fixtures/quantum/spectra-native-nmr.cjson", import.meta.url), "utf8"), parsed = readCjsonGraph("nmr.cjson", input);
      text = parsed.structure.molfile; extension = "mol"; original = new Blob([input]);
      science = { format: "cjson", atoms: parsed.structure.atoms, frames: parsed.coordinateSets.map(atoms => ({ atoms })), modes: [], orbitals: [],
        graph: { molfile: text, activeFrameIndex: parsed.activeSet }, spectra: parsed.spectra };
    }
    const raw = await plugin.builders.data.rawData({ data: text });
    const trajectory = await plugin.builders.structure.parseTrajectory(raw, extension);
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const structure = plugin.managers.structure.hierarchy.current.structures[0];
    const content: ScienceSessionContent = { documentUuid: crypto.randomUUID(), source: { extension, text }, atomIds: null,
      binding: { structureRef: structure.cell.transform.ref, modelRef: structure.model!.cell.transform.ref, trajectoryRef: trajectory.ref, frameIndex: 0, frameCount: 1, atomCount: science.atoms.length },
      science, original: { name: version === 4 ? "nmr.cjson" : "authored.out", file: original } };
    if (version === 3) {
      const stream = "10000 -2.25 .12\n10001 -0.125 .25\n", name = "selected.mcd", file = new Blob([stream]);
      const pair = { primaryOriginalSha256: await sha256Hex(new Uint8Array(await original.arrayBuffer())), companionOriginalSha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())), sourceRevisionSha256: await sha256Hex(text) };
      science.frames[0].mcdCompanion = { ...pair, spectra: { kind: "scientific-spectra", version: 1, source: { name, format: "orca-mcd", scope: "frame", frameIndex: 0, frameCount: 1 }, atomicNumbers: [1], spectra: [readOrcaMcdBlocks(stream)[0].spectrum] } };
      content.companions = [{ ...pair, role: "orca-mcd", frameIndex: 0, frameCount: 1, name, file }];
    }
    if (version === "mesoscale") {
      const { MesoscaleState } = await import("molstar/lib/apps/mesoscale-explorer/data/state.js");
      Object.assign(plugin.customState as Record<string, unknown>, { graphicsMode: "quality" }); await MesoscaleState.init(plugin as never);
    }
    if (version !== "plain" && version !== "mesoscale") {
      const encoded = await encodeScienceSession(content); expect(encoded.manifest.version).toBe(version);
      for (const asset of encoded.assets) plugin.managers.asset.set({ kind: "file", id: asset.id as UUID, name: asset.name }, new File([asset.bytes as BlobPart], asset.name));
    }
    return new Uint8Array(await (await plugin.managers.snapshot.serialize({ type: "molx", params: { camera: false, image: false } })).arrayBuffer());
  } finally { plugin.dispose(); }
}

async function choose(bytes: Uint8Array, name: string) {
  const before = useMoleculeStore.getState().documents, noop = () => {}; let chooser!: ReturnType<typeof useAppOpenActions>;
  const options: Parameters<typeof useAppFileOpen>[0] = { ...useMoleculeStore.getState(), preferences: { ...defaultPreferences, rendererMode: "molstar" },
    addProjectRoot: noop, detectContentSpectrumPaths, expandStructureBundles: async paths => paths, openDockTab: noop, openDocumentTab: noop, openFepNetworkTab: noop,
    pushErrorStatus: error => { throw error; }, pushStatus: noop, rememberRecentStructures: noop, setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop };
  function AppOpen() { const open = useAppFileOpen(options); chooser = useAppOpenActions({ openPaths: open.openPaths, openStructureRecords: open.openStructureRecords, pushErrorStatus: options.pushErrorStatus, pushStatus: noop, recentStructures: [] }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); let connected = false;
  const click = spyOn(browser.HTMLInputElement.prototype, "click").mockImplementation(function (this: InstanceType<typeof browser.HTMLInputElement>) {
    connected = this.isConnected; Object.defineProperty(this, "files", { value: [new File([bytes as BlobPart], name)] }); this.dispatchEvent(new browser.Event("change"));
  });
  try {
    await act(async () => root.render(<AppOpen />)); await act(async () => { await chooser.chooseFiles(); }); expect(connected).toBe(true);
    const opened = useMoleculeStore.getState().documents.filter(doc => !before.includes(doc)); expect(opened).toHaveLength(1); return opened[0];
  } finally { click.mockRestore(); await act(async () => root.unmount()); host.remove(); }
}
function runtimeBytes(document: ViewerDocument) {
  const base64 = document.runtimePath.match(/window\.BuretteDataBase64\s*=\s*"([^"]*)"/)?.[1];
  if (!base64) throw new Error("No actual runtime binary payload");
  return new Uint8Array(Buffer.from(base64, "base64"));
}

test("actual ordinary chooser preserves a native v4 MOLX payload and restores CJSON science and Original", async () => {
  const bytes = await archive(4), expected = (await decodeScienceSession(bytes))!, document = await choose(bytes, "cjson-scene.molx");
  expect(document.viewerProfile).toBe("structure"); expect(document.byteCount).toBe(bytes.length); expect(isScienceSessionCandidate(document)).toBe(true);
  const stored = (await readBrowserImport(document.path))!; expect(stored.kind).toBe("binary"); expect(readBrowserDevVirtualTextDocument(document.path)).toBeNull();
  expect(runtimeBytes(document)).toEqual(bytes); expect(await readSceneDocumentBytes(document)).toEqual(bytes);
  const native = new PluginContext(DefaultPluginSpec()); await native.init();
  try {
    const token = scene.beginImport(native); await native.managers.snapshot.open(new File([runtimeBytes(document) as BlobPart], "reopened.molx")); expect(scene.completeImport(native, token)).toBe(true);
    const request = async (_id: string, action: Record<string, unknown>) => {
      if (action.type === "workspace_scene_state") return { ready: true };
      if (action.type === "scene_science_binding") return scene.graphBinding({ plugin: native }, action.sourceExtension);
      if (action.type === "scene_science_restore_ack") return { adopted: await scene.adoptValidated({ plugin: native }, action) };
      throw new Error(`Unexpected ${action.type}`);
    };
    expect(await restoreScienceSession(document, { readBytes: readSceneDocumentBytes, request, isOpen: () => true })).toBe("restored");
    const text = logicalSourceFor(document.id)!.text, state = scientificStateFor(document.id, text);
    expect(JSON.stringify(state.revision!.document)).toBe(JSON.stringify(expected.science));
    expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(new Uint8Array(await expected.original!.file.arrayBuffer()));
  } finally { native.dispose(); }
});

test("ordinary chooser keeps valid v1, v3 and plain MOLX on their existing structure route", async () => {
  for (const version of [1, 3, "plain"] as const) {
    const bytes = await archive(version), document = await choose(bytes, `legacy-${version}.molx`);
    expect(document.viewerProfile).toBe("structure"); expect(runtimeBytes(document)).toEqual(bytes);
    expect(await decodeScienceSession(runtimeBytes(document))).toEqual(await decodeScienceSession(bytes));
  }
});

test("fresh durable binary import reads exact bytes and malformed archives retain the Mesoscale error route", async () => {
  const bytes = await archive(4), saved = await saveBrowserImport({ path: "/OpenedFiles/fresh-binary.molx", name: "fresh-binary.molx", kind: "binary", file: new Blob([bytes as BlobPart]) });
  const legacy = await saveBrowserImport({ path: "/OpenedFiles/old-text.molx", name: "old-text.molx", kind: "text", file: new Blob([bytes as BlobPart]) });
  const result = await openBrowserDevDocuments([saved.path, legacy.path], defaultPreferences); expect(result.errors).toEqual([]); expect(result.documents[0].viewerProfile).toBe("structure"); expect(runtimeBytes(result.documents[0])).toEqual(bytes); expect(runtimeBytes(result.documents[1])).toEqual(bytes); expect(result.documents[1].viewerProfile).toBe("structure");
  const legacyRegistered = await saveBrowserImport({ path: "/OpenedFiles/old-registered.molx", name: "old-registered.molx", kind: "text", file: new Blob([bytes as BlobPart]) });
  const { initializeBrowserImportedFiles } = await import("../apps/desktop/src/lib/web-demo-workspace");
  await initializeBrowserImportedFiles();
  const restored = await openBrowserDevDocuments([legacyRegistered.path], defaultPreferences);
  expect(runtimeBytes(restored.documents[0])).toEqual(bytes); expect(restored.documents[0].viewerProfile).toBe("structure");
  const malformed = Uint8Array.of(0x50, 0x4b, 3, 4, 255, 0, 128), document = await choose(malformed, "invalid.molx");
  expect(document.viewerProfile).toBe("mesoscale"); expect(runtimeBytes(document)).toEqual(malformed);
});


test("actual Mesoscale state and larger supported MOLX keep their own chooser routes", async () => {
  const bytes = await archive("mesoscale"), document = await choose(bytes, "native-mesoscale.molx");
  expect(document.viewerProfile).toBe("mesoscale"); expect(runtimeBytes(document)).toEqual(bytes); expect(isScienceSessionCandidate(document)).toBe(false);
  const large = zipSync({ ...unzipSync(await archive("plain")), "padding.bin": new Uint8Array(3 * 1024 * 1024) }, { level: 0 });
  expect(large.byteLength).toBeGreaterThan(3 * 1024 * 1024);
  const opened = await choose(large, "large-scene.molx"); expect(opened.viewerProfile).toBe("structure"); expect(runtimeBytes(opened)).toEqual(large);
});
