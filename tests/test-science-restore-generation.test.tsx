import { afterAll, expect, test } from "bun:test";
import React, { act } from "react";
import { Window } from "happy-dom";
import { zipSync, strToU8 } from "../apps/desktop/node_modules/fflate/esm/browser.js";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { XYZ, waterScience } from "./scientific-data-fixture";
import { encodeScienceSession, readXyzFrames } from "../apps/desktop/src/lib/science-session/codec";
import { restoreScienceSession } from "../apps/desktop/src/lib/science-session/restore";
import { adoptLogicalSource, beginScienceSessionRestore, captureLogicalSourceOwner, documentUuidFor, logicalSourceFor, plainAtomIds, releaseClosedScienceSessions, sourceExtension, useLogicalSource } from "../apps/desktop/src/lib/science-session/state";
import { importedOriginalFor, releaseClosedImports, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
const { createRoot } = await import("react-dom/client");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let sequence = 0;
async function fixture() {
  const document: ViewerDocument = { id: `generation-${++sequence}`, path: "/scene.molx", title: "scene.molx", extension: "molx", byteCount: 2048, renderer: "molstar", runtimePath: "scene" };
  const binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 3 };
  const frame = readXyzFrames(XYZ)[0], uuid = crypto.randomUUID(), original = Uint8Array.of(0xef, 0xbb, 0xbf, 13, 10, 255);
  const archive = async (documentUuid = uuid) => {
    const encoded = await encodeScienceSession({ documentUuid, source: { extension: "xyz", text: XYZ }, atomIds: null, binding, science: waterScience(), original: { name: "Original.out", file: new Blob([original]) } });
    return zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))), ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
  };
  // Platform I/O and renderer messages are bounded fakes; the host restore/codec/store are real.
  const request = async (_id: string, action: Record<string, unknown>) => {
    if (action.type === "workspace_scene_state") return { ready: true };
    if (action.type === "scene_science_binding") return { ...binding, importToken: uuid, elements: frame.elements, positions: Float64Array.from(frame.positions) };
    if (action.type === "scene_science_restore_ack") return { adopted: true };
    throw new Error("Unexpected renderer request");
  };
  const bytes = await archive();
  const restore = (readBytes: () => Promise<Uint8Array> = async () => bytes, isOpen = () => true, send = request) => restoreScienceSession(document, { readBytes, isOpen, request: send, pollMs: 1 });
  const host = globalThis.document.createElement("div"); globalThis.document.body.append(host); const root = createRoot(host);
  let seen: ReturnType<typeof logicalSourceFor> = null;
  function Consumer() { seen = useLogicalSource(document.id); return null; }
  await act(async () => root.render(<Consumer />));
  return { document, uuid, original, bytes, archive, restore, request, get seen() { return seen; }, async close() { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); releaseClosedImports(new Set()); } };
}
test("real held restore hides the published source and invalidates first reads before same-byte/null-ID adoption", async () => {
  const f = await fixture(), gate = deferred<Uint8Array>(); try {
    await act(async () => { expect(await f.restore()).toBe("restored"); });
    const before = logicalSourceFor(f.document.id), oldOwner = captureLogicalSourceOwner(f.document.id), original = importedOriginalFor(f.document.id);
    let pending!: ReturnType<typeof f.restore>; await act(async () => { pending = f.restore(() => gate.promise); });
    const pendingOwner = captureLogicalSourceOwner(f.document.id);
    expect([logicalSourceFor(f.document.id), f.seen, sourceExtension(f.document), oldOwner(), pendingOwner()]).toEqual([null, null, "molx", false, false]);
    expect(importedOriginalFor(f.document.id)).toBe(original); expect(before?.text).toBe(XYZ);
    await act(async () => { gate.resolve(f.bytes); expect(await pending).toBe("restored"); });
    expect(f.seen).toBe(logicalSourceFor(f.document.id)); expect(f.seen).not.toBe(before);
    expect([documentUuidFor(f.document.id), plainAtomIds(f.document.id, ["O", "H", "H"]), oldOwner(), pendingOwner(), captureLogicalSourceOwner(f.document.id)()]).toEqual([f.uuid, null, false, false, true]);
    expect(scientificStateFor(f.document.id, XYZ).revision?.document).toEqual(waterScience());
    expect(new Uint8Array(await importedOriginalFor(f.document.id)!.file.arrayBuffer())).toEqual(f.original);
  } finally { gate.resolve(f.bytes); await f.close(); }
});
test("overlapping B and C restores cannot publish B or revive A after C wins", async () => {
  const f = await fixture(), gate = deferred<Uint8Array>(); try {
    await act(async () => { await f.restore(); }); const a = logicalSourceFor(f.document.id);
    let b!: ReturnType<typeof f.restore>; await act(async () => { b = f.restore(() => gate.promise); });
    const bOwner = captureLogicalSourceOwner(f.document.id), cUuid = crypto.randomUUID(), cBytes = await f.archive(cUuid);
    await act(async () => { expect(await f.restore(async () => cBytes)).toBe("restored"); });
    const c = logicalSourceFor(f.document.id), cOwner = captureLogicalSourceOwner(f.document.id);
    await act(async () => { gate.resolve(f.bytes); expect(await b).toBe("cancelled"); });
    expect(logicalSourceFor(f.document.id)).toBe(c); expect(c).not.toBe(a);
    expect([documentUuidFor(f.document.id), bOwner(), cOwner()]).toEqual([cUuid, false, true]);
  } finally { gate.resolve(f.bytes); await f.close(); }
});
for (const outcome of ["foreign", "invalid", "failed-ack", "cancelled"] as const) test(`${outcome} restore never republishes retained old identity`, async () => {
  const f = await fixture(), gate = deferred<Uint8Array>(); try {
    await act(async () => { await f.restore(); }); const old = logicalSourceFor(f.document.id), owner = captureLogicalSourceOwner(f.document.id), original = importedOriginalFor(f.document.id);
    const bytes = outcome === "foreign" ? zipSync({ "state.json": strToU8('{"entries":[]}') }) : outcome === "invalid" ? Uint8Array.of(255) : f.bytes;
    let open = true, restoring!: ReturnType<typeof f.restore>;
    await act(async () => { restoring = f.restore(() => gate.promise, () => open, async (id, action) => action.type === "scene_science_restore_ack" && outcome === "failed-ack" ? { adopted: false } : f.request(id, action)); });
    await act(async () => {
      if (outcome === "cancelled") open = false; gate.resolve(bytes);
      if (outcome === "invalid" || outcome === "failed-ack") await expect(restoring).rejects.toThrow();
      else expect(await restoring).toBe(outcome);
    });
    expect([logicalSourceFor(f.document.id), f.seen, sourceExtension(f.document), owner(), captureLogicalSourceOwner(f.document.id)()]).toEqual([null, null, "molx", false, false]);
    expect(old?.text).toBe(XYZ); expect(importedOriginalFor(f.document.id)).toBe(original);
    expect(new Uint8Array(await original!.file.arrayBuffer())).toEqual(f.original);
  } finally { gate.resolve(f.bytes); await f.close(); }
});
test("direct validated adoption publishes once per lifetime; closed release revokes the captured owner", () => {
  const id = "direct-generation", input = { documentId: id, extension: "xyz", text: XYZ } as const;
  const plain = captureLogicalSourceOwner(id); expect(plain()).toBe(true);
  beginScienceSessionRestore(id); expect(plain()).toBe(false); expect(captureLogicalSourceOwner(id)()).toBe(false);
  adoptLogicalSource(input, crypto.randomUUID(), null, ["O", "H", "H"]); const a = logicalSourceFor(id), aOwner = captureLogicalSourceOwner(id);
  adoptLogicalSource(input, documentUuidFor(id), null, ["O", "H", "H"]); const bOwner = captureLogicalSourceOwner(id);
  expect(logicalSourceFor(id)).not.toBe(a); expect([aOwner(), bOwner()]).toEqual([false, true]);
  releaseClosedScienceSessions(new Set()); expect([logicalSourceFor(id), bOwner()]).toEqual([null, false]);
});
