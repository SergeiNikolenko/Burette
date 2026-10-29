import { expect, mock, test } from "bun:test";
import { PluginStateSnapshotManager } from "../node_modules/molstar/lib/mol-plugin-state/manager/snapshots.js";
import { fakeViewer, realXyzViewer, science, bindingOf, waterScience, XYZ } from "./science-session-fixture";
import { encodeScienceSession } from "../apps/desktop/src/lib/science-session/codec";
import { beginScienceSessionRestore, logicalSourceFor, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { importedOriginalFor, releaseScopedScientificSource, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
const { restoreScienceSession } = await import("../apps/desktop/src/lib/science-session/restore");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let sequence = 0;
async function fixture() {
  const source = fakeViewer(XYZ), report = science.binding(source.viewer), binding = bindingOf(report);
  const original = Uint8Array.of(0xef, 0xbb, 0xbf, 13, 10, 255);
  const encoded = await encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: "xyz", text: XYZ },
    atomIds: ["o", "h1", "h2"], binding, science: waterScience(), original: { name: "original.out", file: new Blob([original]) } });
  const blob = await science.serialize(source.viewer, { binding, positions: report.positions, assets: encoded.assets }, { type: "molx" });
  const bytes = new Uint8Array(await blob.arrayBuffer()), opened = await realXyzViewer(XYZ), plugin = opened.viewer.plugin as any;
  Object.assign(plugin, { runTask: (task: { run: () => Promise<unknown> }) => task.run(), log: { error() {} } });
  const token = science.beginImport(plugin);
  await (PluginStateSnapshotManager.prototype.open as any).call({ plugin, setStateSnapshot: async () => {}, events: { opened: { next() {} } } }, new File([bytes], "scene.molx"));
  expect(science.completeImport(plugin, token)).toBe(true);
  const document = { id: `ownership-${++sequence}`, path: "/scene.molx", extension: "molx", renderer: "molstar", viewerProfile: "structure", byteCount: bytes.length } as never;
  const id = (document as { id: string }).id;
  const request = async (_id: string, action: Record<string, unknown>) => {
    if (action.type === "workspace_scene_state") return { ready: true };
    if (action.type === "scene_science_binding") return science.binding(opened.viewer);
    if (action.type === "scene_science_restore_ack") return { adopted: await science.adoptValidated(opened.viewer, action) };
    throw new Error("Unexpected viewer action");
  };
  return { document, id, plugin, bytes, original, request, close() { releaseScopedScientificSource(id); releaseClosedScienceSessions(new Set()); } };
}

test("host scientific publication waits for the actual validated runtime acknowledgement", async () => {
  const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
  try {
    const restoring = restoreScienceSession(f.document, { readBytes: async () => f.bytes, isOpen: () => true, request: (async (id: string, action: Record<string, unknown>) => {
      const result = await f.request(id, action);
      if (action.type === "scene_science_restore_ack") { entered.resolve(); await release.promise; }
      return result;
    }) as never });
    await entered.promise;
    expect(logicalSourceFor(f.id)).toBeNull(); expect(importedOriginalFor(f.id)).toBeNull();
    release.resolve(); expect(await restoring).toBe("restored");
    expect(scientificStateFor(f.id, XYZ).revision!.document).toEqual(waterScience());
    expect(new Uint8Array(await importedOriginalFor(f.id)!.file.arrayBuffer())).toEqual(f.original);
    expect(f.plugin.managers.asset.assets).toHaveLength(0);
  } finally { release.resolve(); f.close(); }
});

test("failed receipt acknowledgement retains imported assets and never partially publishes host data", async () => {
  const f = await fixture();
  try {
    const assets = [...f.plugin.managers.asset.assets];
    await expect(restoreScienceSession(f.document, { readBytes: async () => f.bytes, isOpen: () => true, request: (async (id: string, action: Record<string, unknown>) =>
      f.request(id, action.type === "scene_science_restore_ack" ? { ...action, manifestSha256: "0".repeat(64) } : action)) as never })).rejects.toThrow();
    expect(logicalSourceFor(f.id)).toBeNull(); expect(importedOriginalFor(f.id)).toBeNull();
    expect(f.plugin.managers.asset.assets).toEqual(assets);
    expect(await restoreScienceSession(f.document, { readBytes: async () => f.bytes, isOpen: () => true, request: f.request as never })).toBe("restored");
  } finally { f.close(); }
});

test("a changed host generation after a valid ACK cannot publish the old scientific source", async () => {
  const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
  try {
    const restoring = restoreScienceSession(f.document, { readBytes: async () => f.bytes, isOpen: () => true, request: (async (id: string, action: Record<string, unknown>) => {
      const result = await f.request(id, action);
      if (action.type === "scene_science_restore_ack") { entered.resolve(); await release.promise; }
      return result;
    }) as never });
    await entered.promise; beginScienceSessionRestore(f.id); release.resolve();
    expect(await restoring).toBe("cancelled");
    expect(logicalSourceFor(f.id)).toBeNull(); expect(importedOriginalFor(f.id)).toBeNull();
    expect(f.bytes.byteLength).toBeGreaterThan(0);
  } finally { release.resolve(); f.close(); }
});
