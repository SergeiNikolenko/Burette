import { expect, mock } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import vm from "node:vm";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window as BrowserWindow } from "happy-dom";
plugin({
  name: "native-scientific-consumers",
  setup(build) {
    build.onLoad(
      {
        filter:
          /(?:hooks\/use-source-editing|science-session\/restore|workspace-panes\/native-scene-window)\.ts$/u,
      },
      ({ path }) => ({
        contents: transformSync(readFileSync(path, "utf8"), {
          filename: path,
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ["typescript"] },
          plugins: [["babel-plugin-react-compiler", {}]],
        })!.code!,
        loader: "ts",
      }),
    );
  },
});
const browser = new BrowserWindow({ url: "http://localhost/" });
Object.assign(browser, { setImmediate, clearImmediate });
for (const key of [
  "document",
  "navigator",
  "HTMLElement",
  "HTMLIFrameElement",
  "Element",
  "Node",
  "Event",
  "MessageEvent",
  "CustomEvent",
  "MutationObserver",
  "localStorage",
  "CSS",
] as const)
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const nativeFiles = new Map<string, Uint8Array>(),
  readPlans = new Map<string, () => Promise<ArrayBuffer>>();
export const writes: { command: string; path: string; bytes: Uint8Array }[] = [],
  relays: any[] = [];
let receiver: ((event: { payload: any }) => Promise<void>) | undefined,
  parentAlive = true;
let cacheGate: ReturnType<typeof deferred<void>> | null = null,
  joinGate: ReturnType<typeof deferred<void>> | null = null;
let cacheEntered = false,
  joinEntered = false;
mock.module("@tauri-apps/api/path", () => ({
  appCacheDir: async () => {
    cacheEntered = true;
    await cacheGate?.promise;
    return "/cache";
  },
  join: async (...parts: string[]) => {
    joinEntered = true;
    await joinGate?.promise;
    return parts.join("/");
  },
}));
mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "workspace-current",
    listen: async (_channel: string, callback: typeof receiver) => {
      receiver = callback;
      return () => {
        receiver = undefined;
      };
    },
  }),
  Window: { getByLabel: async () => (parentAlive ? {} : null) },
}));
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: any) => {
    if (command === "read_document_file") {
      const plan = readPlans.get(args.path);
      if (plan) return plan();
      const bytes = nativeFiles.get(args.path);
      if (!bytes) throw new Error("Unknown native file");
      return bytes.slice().buffer;
    }
    if (
      command === "write_base64_file" ||
      command === "save_popout_scene" ||
      command === "write_text_file"
    ) {
      const bytes =
        command === "write_text_file"
          ? new TextEncoder().encode(args.request.contents)
          : Uint8Array.from(Buffer.from(args.request?.contentsBase64 ?? args.dataBase64, "base64"));
      const path = args.request?.outputPath ?? `/private/popout-scenes/${crypto.randomUUID()}.molx`;
      nativeFiles.set(path, bytes);
      writes.push({ command, path, bytes });
      return path;
    }
    if (command === "open_source_edit_session")
      return {
        handleId: crypto.randomUUID(),
        content: new TextDecoder().decode(nativeFiles.get(args.request.documentId)!),
        revision: { modifiedAt: 1, byteCount: 100, contentHash: "before" },
        previewMode: "live",
      };
    if (command === "close_source_edit_session" || command === "close_workspace_window") return;
    if (command === "relay_popout_handoff") {
      relays.push(args);
      return;
    }
    if (command === "open_new_workspace_window") return "workspace-peer";
    if (command === "plugin:window|get_all_windows") return parentAlive ? ["workspace-parent"] : [];
    throw new Error(`Unexpected native IPC: ${command}`);
  },
}));
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js"),
  { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useScienceSessionRestore, waitForSceneScienceRestore } =
  await import("../apps/desktop/src/lib/science-session/restore");
const { encodeScienceSession, decodeScienceSession } =
  await import("../apps/desktop/src/lib/science-session/codec");
const { logicalSourceFor, beginScienceSessionRestore, releaseClosedScienceSessions } =
  await import("../apps/desktop/src/lib/science-session/state");
const { releaseScopedScientificSource } =
  await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { graphSourceMetadata, graphDraftText } =
  await import("../apps/desktop/src/lib/workbench/graph-draft");
const { patchGraphMetadata } = await import("../apps/desktop/src/lib/workbench/graph-metadata");
const { tabFileDragPayload } =
  await import("../apps/desktop/src/components/editor-area/tab-file-drag");
const { useNativePopoutSession, popOutNativeScene, returnNativePopout, nativePopoutBusy } =
  await import("../apps/desktop/src/components/workspace-panes/native-scene-window");
const { XYZ, waterScience } = await import("./scientific-data-fixture");
Object.defineProperty(browser, "__TAURI_INTERNALS__", { configurable: true, value: {} });
const viewerCode = readFileSync(
  new URL("../PreviewExtension/Web/viewer.js", import.meta.url),
  "utf8",
);
const extract = (name: string) =>
  viewerCode.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, "u"))![0];
export const until = async (ready: () => boolean) => {
  for (let i = 0; i < 250 && !ready(); i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  expect(ready()).toBe(true);
};
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let sequence = 0;
export async function fixture(kind: "xyz" | "sdf" | "foreign" | "plain" = "xyz", pending = false) {
  writes.length = 0;
  relays.length = 0;
  parentAlive = true;
  cacheGate = joinGate = null;
  cacheEntered = joinEntered = false;
  const scope: Record<string, any> = {};
  for (const name of ["scene-file-actions", "burette-agent"])
    vm.runInNewContext(
      readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), "utf8"),
      {
        window: scope,
        crypto,
        TextEncoder,
        TextDecoder,
        Uint8Array,
        Float64Array,
        File,
        Blob,
        btoa,
        atob,
        setTimeout,
        clearTimeout,
      },
    );
  const science = scope.BuretteSceneFiles.science,
    plugins: any[] = [];
  const create = async () => {
    const plugin = new PluginContext(DefaultPluginSpec());
    await plugin.init();
    plugin.state.setSnapshotParams({ camera: false });
    plugins.push(plugin);
    return plugin;
  };
  const sample = readFileSync(
      new URL("../samples/collections/sdf/single.sdf", import.meta.url),
      "utf8",
    ),
    metadata = graphSourceMetadata(sample, "sdf", 3)!;
  const sdf = graphDraftText(sample, "sdf", sample.split("$$$$")[0], metadata),
    pdb = "ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C\nEND\n";
  const source = kind === "sdf" ? sdf : kind === "plain" ? pdb : XYZ,
    format = kind === "sdf" ? "sdf" : kind === "plain" ? "pdb" : "xyz";
  const initial = await create(),
    raw = await initial.builders.data.rawData({ data: source });
  const trajectory = await initial.builders.structure.parseTrajectory(raw, format);
  await initial.builders.structure.hierarchy.applyPreset(trajectory, "default", {
    representationPreset: "empty",
  });
  const report =
    format === "sdf"
      ? await science.sdfBinding({ plugin: initial })
      : format === "xyz"
        ? science.binding({ plugin: initial })
        : null;
  const binding =
    report &&
    Object.fromEntries(
      ["structureRef", "modelRef", "trajectoryRef", "frameIndex", "frameCount", "atomCount"].map(
        (key) => [key, report[key]],
      ),
    );
  const original =
    kind === "sdf"
      ? new TextEncoder().encode("\uFEFF" + sample.replace(/\n/gu, "\r\n"))
      : Uint8Array.of(239, 187, 191, 13, 10, 0, 255);
  const atomIds = kind === "sdf" ? metadata.atoms.map((atom) => atom.id) : ["o", "h1", "h2"],
    documentUuid = crypto.randomUUID();
  const encoded =
    kind === "xyz" || kind === "sdf"
      ? await encodeScienceSession({
          documentUuid,
          source: { extension: kind, text: source },
          atomIds,
          binding,
          science: kind === "xyz" ? waterScience() : null,
          original: {
            name: kind === "sdf" ? "original.sdf" : "water.out",
            file: new Blob([original]),
          },
        })
      : null;
  const archive =
    kind === "plain"
      ? new Blob([pdb])
      : encoded
        ? await science.serialize(
            { plugin: initial },
            {
              binding,
              positions: report.positions,
              ...(kind === "sdf" ? { sourceSha256: report.sourceSha256 } : {}),
              assets: encoded.assets,
            },
            { type: "molx", params: { camera: false, image: false } },
          )
        : await initial.managers.snapshot.serialize({
            type: "molx",
            params: { camera: false, image: false },
          });
  const bytes = new Uint8Array(await archive.arrayBuffer()),
    plugin = kind === "plain" ? initial : await create();
  if (kind !== "plain") {
    const token = science.beginImport(plugin);
    await plugin.managers.snapshot.open(new File([bytes], "input.molx"));
    expect(science.completeImport(plugin, token)).toBe(true);
  }
  const viewer = { plugin };
  scope.BuretteAgent.notifyStructureLoaded({ viewer, plugin });
  const id = `native-science-${++sequence}`,
    path =
      kind === "plain"
        ? "/Structures/plain.pdb"
        : `/private/popout-scenes/${crypto.randomUUID()}.molx`;
  const doc = {
    id,
    path,
    title: kind === "plain" ? "plain.pdb" : "Restored scene.molx",
    extension: kind === "plain" ? "pdb" : "molx",
    renderer: "molstar",
    viewerProfile: "structure",
    runtimePath: `<html>${id}</html>`,
    byteCount: bytes.length,
    sceneUnsaved: false,
  } as any;
  nativeFiles.set(path, bytes);
  nativeFiles.set(id, new TextEncoder().encode(pdb));
  const heldRead = deferred<ArrayBuffer>();
  readPlans.set(path, () => heldRead.promise);
  const surface = document.createElement("div"),
    frame = document.createElement("iframe");
  surface.className = "page-surface";
  frame.className = "viewer-iframe";
  frame.dataset.documentId = id;
  frame.dataset.renderer = "molstar";
  surface.append(frame);
  document.body.append(surface);
  let snapshotGate: ReturnType<typeof deferred<void>> | null = null,
    snapshotEntered = false;
  const execute = new Function(
    "activeMolstarViewer",
    "window",
    "activeConfig",
    "bytesToBase64",
    "document",
    `${extract("executeBuretteAgentAction")};return executeBuretteAgentAction;`,
  )(
    () => viewer,
    scope,
    {},
    (value: Uint8Array) => Buffer.from(value).toString("base64"),
    document,
  );
  frame.contentWindow!.postMessage = (envelope) => {
    if (envelope.body.type !== "agent-action") return;
    const action = envelope.body.action;
    void execute(action)
      .then(async (result: any) => {
        if (action.type === "workspace_scene_snapshot" && snapshotGate) {
          snapshotEntered = true;
          await snapshotGate.promise;
        }
        return result;
      })
      .catch((error: Error) => ({ ok: false, error: { message: error.message } }))
      .then((result: any) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            data: {
              source: "burette-agent-viewer",
              body: { type: "agent-action-result", id: envelope.body.id, result },
            },
          }),
        ),
      );
  };
  useMoleculeStore.getState().setDocuments([doc]);
  let controller!: ReturnType<typeof useSourceEditingController>;
  function NativeListener() {
    useNativePopoutSession({
      openStructurePaths: async () => {
        throw new Error("Unexpected receiver open");
      },
    } as any);
    return null;
  }
  function Fixture() {
    const documents = useMoleculeStore((value) => value.documents);
    useScienceSessionRestore(documents);
    controller = useSourceEditingController({
      activeDocument: documents[0] ?? null,
      preferences: defaultPreferences,
      pushErrorStatus: (error) => {
        throw error;
      },
      setDockOpen() {},
      setDockActiveTab() {},
    });
    return (
      <SourceEditingProvider value={controller}>
        <NativeListener />
      </SourceEditingProvider>
    );
  }
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  await act(async () => root.render(<Fixture />));
  const tab = () =>
    useMoleculeStore.getState().tabs.find((value) => value.location.kind === "file")!;
  const state = () => ({
    documents: useMoleculeStore.getState().documents,
    textDocuments: [],
    dirtyGridDocuments: new Set<string>(),
  });
  const ready = async () => {
    heldRead.resolve(bytes.slice().buffer);
    if (kind !== "plain")
      await act(async () => {
        await waitForSceneScienceRestore(doc);
      });
  };
  if (!pending) await ready();
  return {
    doc,
    source,
    bytes,
    original,
    atomIds,
    documentUuid,
    viewer,
    heldRead,
    ready,
    surface,
    get controller() {
      return controller;
    },
    tab,
    drag: () => tabFileDragPayload([tab()], state() as any, controller),
    reserved: () =>
      plugin.managers.asset.assets.filter((entry) =>
        String(entry.asset.id).startsWith("burette-science-"),
      ).length,
    async replace() {
      const replacement = { ...doc, id: id + "-replacement", runtimePath: "replacement runtime" };
      await act(async () => useMoleculeStore.getState().openDocumentsInActiveTab([replacement]));
    },
    async editSdf() {
      const mol = source.slice(0, source.indexOf("M  END") + 6),
        edited = graphDraftText(
          source,
          "sdf",
          mol,
          patchGraphMetadata(metadata, { conformerLabel: "Dragged current draft" }),
        );
      await act(async () => controller.beginEditing(doc));
      const rawCell = [...plugin.state.data.cells.values()].find(
        (cell) => cell.transform.transformer.id === "ms-plugin.raw-data",
      )!;
      await plugin.state.data.build().to(rawCell.transform.ref).update({ data: edited }).commit();
      await act(async () => controller.updateDraft(doc, edited, { previewApplied: true }));
      expect(controller.sessionForDocument(doc)?.dirty).toBe(true);
      return edited;
    },
    holdSnapshot() {
      snapshotGate = deferred<void>();
    },
    snapshotEntered: () => snapshotEntered,
    releaseSnapshot() {
      snapshotGate?.resolve();
    },
    async close() {
      heldRead.resolve(bytes.slice().buffer);
      snapshotGate?.resolve();
      cacheGate?.resolve();
      joinGate?.resolve();
      for (let attempt = 0; attempt < 4 && nativePopoutBusy(); attempt++) {
        await tick();
        for (const row of relays.filter(
          (row) => row.message.kind === "offer" || row.message.kind === "return",
        ))
          await receiver?.({ payload: { kind: "failed", id: row.message.id, from: row.target } });
      }
      await act(async () => useMoleculeStore.getState().setDocuments([]));
      await returnNativePopout();
      await act(async () => root.unmount());
      releaseScopedScientificSource(id);
      releaseClosedScienceSessions(new Set());
      readPlans.delete(path);
      surface.remove();
      mount.remove();
      plugins.forEach((plugin) => plugin.dispose());
    },
  };
}
export async function assertArchive(
  file: Uint8Array,
  view: Awaited<ReturnType<typeof fixture>>,
  text = view.source,
) {
  const decoded = (await decodeScienceSession(file))!;
  expect(decoded !== null).toBe(true);
  expect({
    uuid: decoded.documentUuid,
    atoms: decoded.atomIds,
    source: decoded.source,
    science: decoded.science,
  }).toEqual({
    uuid: view.documentUuid,
    atoms: view.atomIds,
    source: {
      extension: view.doc.extension === "molx" && text.includes("M  END") ? "sdf" : "xyz",
      text,
    },
    science: text.includes("M  END") ? null : waterScience(),
  });
  expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(view.original);
}
export function sendNativeMessage(payload: unknown) {
  return receiver!({ payload });
}
export function setParentAlive(value: boolean) {
  parentAlive = value;
}
export function holdPath(phase: "cacheDir" | "join") {
  const gate = deferred<void>();
  if (phase === "cacheDir") cacheGate = gate;
  else joinGate = gate;
  return {
    entered: () => (phase === "cacheDir" ? cacheEntered : joinEntered),
    release: () => gate.resolve(),
  };
}
