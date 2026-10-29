import { expect, test } from "bun:test";
import { unzipSync } from "../apps/desktop/node_modules/fflate/esm/browser.js";
import { fakeViewer, realXyzViewer, science, waterScience, XYZ } from "./science-session-fixture";
import { ORIGINAL, importedDocument, options, exportArchive, restore, request, sceneDocument, openSceneArchive } from "./science-host-fixture";
import { recordImportedRevision, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { logicalSourceFor, sourceExtension, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { decodeScienceSession } from "../apps/desktop/src/lib/science-session/codec";
import { prepareSceneScienceExport } from "../apps/desktop/src/lib/science-session/export";
import { restoreScienceSession } from "../apps/desktop/src/lib/science-session/restore";
import { writeBrowserDevVirtualTextDocument } from "../apps/desktop/src/lib/browser-dev-documents";
test("two restored scenes with the same name and bytes keep separate state", async () => {
  const { document, text } = importedDocument();
  const bytes = await exportArchive(document, text);
  const left = await restore(bytes, "/A/scene.molx", fakeViewer(text));
  const right = await restore(bytes, "/B/scene.molx", fakeViewer(text));
  const edited = text.replace("0.117300", "0.127300");
  const science = waterScience();
  science.atoms[0] = { ...science.atoms[0], z: 0.1273 };
  expect(recordImportedRevision(left.document.id, text, { text: edited, document: science })).not.toBeNull();
  expect(scientificStateFor(left.document.id, edited).revision?.text).toBe(edited);
  expect(scientificStateFor(right.document.id, edited).revision).toBeNull();
  expect(scientificStateFor(right.document.id, text).revision?.text).toBe(text);
  expect(logicalSourceFor(left.document.id)).not.toBe(logicalSourceFor(right.document.id));
});

test("an edit, a close or a new revision during the export rejects the archive; an unacknowledged draft is refused", async () => {
  const { document, text } = importedDocument();
  const edited = text.replace("0.117300", "0.137300");
  let session: { content: string; previewState: string } | null = { content: text, previewState: "current" };
  const sourceEditing = { sessionForDocument: () => session };
  const prepare = (extra: Record<string, unknown> = {}) => prepareSceneScienceExport(document as never, options(fakeViewer(text), { sourceEditing, ...extra }) as never);
  let prepared = await prepare();
  session = { content: edited, previewState: "current" };
  expect(() => prepared!.kind === "science" && prepared!.confirm()).toThrow(/source changed while the scene was being saved/);
  session = { content: text, previewState: "current" };
  prepared = await prepare({ isOpen: () => false });
  expect(() => prepared!.kind === "science" && prepared!.confirm()).toThrow(/document closed/);
  prepared = await prepare();
  const science = waterScience();
  recordImportedRevision(document.id, text, { text, document: science });
  expect(() => prepared!.kind === "science" && prepared!.confirm()).toThrow(/source changed/);
  session = { content: text, previewState: "staging" };
  await expect(prepare()).rejects.toThrow(/does not show the current source yet/);
  // The scene showing other coordinates than the source is refused before anything is sent.
  session = { content: edited, previewState: "current" };
  await expect(prepare()).rejects.toThrow(/does not show the current source yet/);
});

test("a scene of several files keeps its Mol* scene and says scientific data is not saved", async () => {
  const { document, text } = importedDocument();
  expect(await prepareSceneScienceExport(document as never, options(fakeViewer(text), { sceneFileCount: 2 }) as never))
    .toEqual({ kind: "unsupported", reason: "Scientific data belongs to one structure, and this scene now has several." });
  const pdb = { id: "pdb-doc", path: "/a.pdb", extension: "pdb", renderer: "molstar" };
  expect(await prepareSceneScienceExport(pdb as never, options(fakeViewer(text)) as never)).toBeNull();
});

test("atom ids follow revisions: same topology keeps them, a mapped reorder permutes, an unmapped change has none, Undo returns them", async () => {
  const { document, text } = importedDocument();
  // The current text is the draft of a source session the scene shows.
  const ids = async (current: string) => (await decodeScienceSession(await exportArchive(document, current, fakeViewer(current),
    { sourceEditing: { sessionForDocument: () => ({ content: current, previewState: "current" }) } })))!.atomIds;
  const original = await ids(text);
  const moved = text.replace("0.117300", "0.117400");
  const movedScience = waterScience();
  movedScience.atoms[0] = { ...movedScience.atoms[0], z: 0.1174 };
  movedScience.frames = [{ atoms: movedScience.atoms }];
  recordImportedRevision(document.id, text, { text: moved, document: movedScience, topology: undefined });
  expect(await ids(moved)).toEqual(original);
  // Reordered hydrogens, with the mapping a topology edit provides.
  const lines = moved.split("\r\n");
  const reordered = [lines[0], lines[1], lines[2], lines[4], lines[3], ""].join("\r\n");
  const reorderedScience = { ...movedScience, atoms: [movedScience.atoms[0], movedScience.atoms[2], movedScience.atoms[1]], frames: [{ atoms: [movedScience.atoms[0], movedScience.atoms[2], movedScience.atoms[1]] }] };
  recordImportedRevision(document.id, moved, { text: reordered, document: reorderedScience, topology: 7, sourceAtomIndices: [0, 2, 1] });
  expect(await ids(reordered)).toEqual([original![0], original![2], original![1]]);
  // The same reorder recorded without a mapping: no ids are claimed.
  const unmapped = reordered.replace("water", "water again");
  recordImportedRevision(document.id, moved, { text: unmapped, document: reorderedScience, topology: 8 });
  expect(await ids(unmapped)).toBeNull();
  // Undo back to the first revision: its ids again.
  expect(await ids(text)).toEqual(original);
});

test("a plain XYZ the scene shows exactly carries its source; an unapplied draft or another scene saves the Mol* scene as before", async () => {
  const path = "burette-ketcher://plain/water.xyz";
  writeBrowserDevVirtualTextDocument(path, XYZ);
  const plain = { id: "plain-xyz", path, title: "water.xyz", extension: "xyz", renderer: "molstar", virtual: true, byteCount: XYZ.length };
  const saved = await exportArchive(plain, XYZ);
  const restored = (await decodeScienceSession(saved))!;
  expect([restored.source.text, restored.science, restored.original]).toEqual([XYZ, null, null]);
  const draft = XYZ.replace("0.117300", "0.217300");
  const staging = { sourceEditing: { sessionForDocument: () => ({ content: draft, previewState: "staging" }) } };
  expect(await prepareSceneScienceExport(plain as never, options(fakeViewer(XYZ), staging) as never)).toBeNull();
  const unshown = { sourceEditing: { sessionForDocument: () => ({ content: draft, previewState: "current" }) } };
  expect(await prepareSceneScienceExport(plain as never, options(fakeViewer(XYZ), unshown) as never)).toBeNull();
});

test("a closed restore cannot regain authority when the same document id opens again", async () => {
  const { document, text } = importedDocument();
  const bytes = await exportArchive(document, text);
  const scene = sceneDocument("/Scenes/reopened.molx") as { id: string };
  let release!: (value: Uint8Array) => void;
  const read = new Promise<Uint8Array>((resolve) => { release = resolve; });
  const dependencies = { readBytes: () => read, request: request(fakeViewer(text)) as never, isOpen: () => true, pollMs: 1 };
  const old = restoreScienceSession(scene as never, dependencies);
  releaseClosedScienceSessions(new Set());
  // Closing permanently revoked the old generation, even before a new restore starts.
  release(bytes);
  expect(await old).toBe("cancelled");
  expect(logicalSourceFor(scene.id)).toBeNull();
  // A replacement restore also supersedes an old operation without relying on its id.
  let releaseOld!: (value: Uint8Array) => void;
  const pending = new Promise<Uint8Array>((resolve) => { releaseOld = resolve; });
  const previous = restoreScienceSession(scene as never, { ...dependencies, readBytes: () => pending });
  const { encodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
  const { bindingOf } = await import("./science-session-fixture");
  const viewer = fakeViewer(text);
  const report = science.binding(viewer.viewer);
  const newerScience = waterScience();
  newerScience.frames[0].energyHartree = -200;
  const encoded = await encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: "xyz", text }, atomIds: null, binding: bindingOf(report), science: newerScience, original: null });
  const blob = await science.serialize(viewer.viewer, { binding: bindingOf(report), positions: report.positions, assets: encoded.assets }, { type: "molx" });
  const newerBytes = new Uint8Array(await blob.arrayBuffer());
  await openSceneArchive(viewer, newerBytes);
  expect(await restoreScienceSession(scene as never, { ...dependencies, readBytes: async () => newerBytes, request: request(viewer) as never })).toBe("restored");
  releaseOld(bytes);
  expect(await previous).toBe("cancelled");
  expect(scientificStateFor(scene.id, text).revision!.document.frames[0].energyHartree).toBe(-200);
});

test("closing during scene readiness or binding revokes restore adoption and errors", async () => {
  const { document, text } = importedDocument();
  const bytes = await exportArchive(document, text);
  for (const stage of ["workspace_scene_state", "scene_science_binding"]) {
    const scene = sceneDocument(`/Scenes/pending-${stage}.molx`) as { id: string };
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => { reached = resolve; });
    let release!: (value: Record<string, unknown>) => void;
    const pending = new Promise<Record<string, unknown>>((resolve) => { release = resolve; });
    const normal = request(fakeViewer(text));
    const running = restoreScienceSession(scene as never, { readBytes: async () => bytes, isOpen: () => true, request: (async (id: string, action: Record<string, unknown>) => {
      if (action.type === stage) { reached(); return pending; }
      return normal(id, action);
    }) as never, pollMs: 1 });
    await waiting;
    releaseClosedScienceSessions(new Set());
    release(stage === "workspace_scene_state" ? { ready: true } : { malformed: true });
    expect(await running).toBe("cancelled");
    expect(logicalSourceFor(scene.id)).toBeNull();
  }
});

test("oversize MOLX produces a named limit failure before reading instead of being classified foreign", async () => {
  const document = { ...(sceneDocument("/Scenes/oversize.molx") as object), byteCount: 33 * 1024 * 1024 };
  let reads = 0;
  await expect(restoreScienceSession(document as never, { readBytes: async () => { reads++; return new Uint8Array(); }, request: request(fakeViewer(XYZ)) as never, isOpen: () => true }))
    .rejects.toMatchObject({ name: "ScienceSessionError", code: "limit" });
  expect(reads).toBe(0);
});

test("scene export confirmation rejects replaced virtual and filesystem source bytes", async () => {
  const { document, text } = importedDocument();
  const prepared = await prepareSceneScienceExport(document as never, options(fakeViewer(text)) as never);
  writeBrowserDevVirtualTextDocument((document as any).path, text.replace("0.117300", "0.217300"));
  expect(() => prepared?.kind === "science" && prepared.confirm()).toThrow(/source changed/);
  const previousFetch = globalThis.fetch;
  let fileText = text;
  let open = true;
  globalThis.fetch = Object.assign(async () => new Response(fileText), { preconnect: previousFetch.preconnect });
  try {
    const file = { id: "filesystem-source-confirm", path: "/Scenes/water.xyz", title: "water.xyz", renderer: "molstar", extension: "xyz", byteCount: text.length };
    const current = await prepareSceneScienceExport(file as never, options(fakeViewer(text), { isOpen: () => open }) as never);
    if (current?.kind !== "science") throw new Error("expected scientific source export");
    await current.confirm();
    fileText = text.replace("0.117300", "0.217300");
    await expect(current.confirm()).rejects.toThrow(/source changed/);
    fileText = text;
    let release!: (value: Response) => void;
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    globalThis.fetch = Object.assign(() => new Promise<Response>((resolve) => { release = resolve; reading(); }), { preconnect: previousFetch.preconnect });
    const confirming = current.confirm();
    await started;
    open = false;
    release(new Response(text));
    await expect(confirming).rejects.toThrow(/document closed/);
  } finally { globalThis.fetch = previousFetch; }
});
