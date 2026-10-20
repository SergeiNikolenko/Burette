import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { chemicalSpaceDocument, moleculeSourceFromMessage } from "../apps/desktop/src/lib/chemical-space-documents";
import { useChemicalSpaceViewerSelection } from "../apps/desktop/src/hooks/use-chemical-space-viewer-selection";

const browser = new Window();
Object.assign(globalThis, { window: browser, document: browser.document, CSS: browser.CSS,
  MessageEvent: browser.MessageEvent, IS_REACT_ACT_ENVIRONMENT: true });
const collection = { id: "grid-a", path: "/a.sdf", renderer: "grid2d" } as ViewerDocument;
const other = { id: "grid-b", path: "/b.sdf", renderer: "grid2d" } as ViewerDocument;
const subset = { id: "subset", path: "/selected.sdf", renderer: "molstar",
  moleculeSource: { documentId: collection.id, path: collection.path, sourceRecordIds: [9, 2, 41] } } as ViewerDocument;

test("collection resolution preserves file identity and validates extracted row metadata", () => {
  expect(chemicalSpaceDocument(subset, [other, collection])).toBe(collection);
  expect(chemicalSpaceDocument({ ...subset, moleculeSource: undefined }, [other, collection])).toBeNull();
  expect(chemicalSpaceDocument({ ...subset, path: collection.path, moleculeSource: undefined }, [other, collection])).toBe(collection);
  expect(moleculeSourceFromMessage({ documentId: collection.id, sourceRecordIds: [9, 2, 41] }, [collection])).toEqual(subset.moleculeSource);
  for (const ids of [[-1], [1.5], ["1"], [], null, Array(100_001).fill(0)]) {
    expect(moleculeSourceFromMessage({ documentId: collection.id, sourceRecordIds: ids }, [collection])).toBeUndefined();
  }
});

test("map and viewer synchronize a reordered subset, reject other frames, and reset on file switch", async () => {
  document.body.innerHTML = '<iframe class="viewer-iframe" data-document-id="subset" data-renderer="molstar"></iframe><iframe class="viewer-iframe" data-document-id="grid-a" data-renderer="grid2d"></iframe><div id="host"></div>';
  const frames = document.querySelectorAll("iframe");
  const viewerMessages: any[] = [], gridMessages: any[] = [];
  frames[0].contentWindow!.postMessage = message => { viewerMessages.push(message); };
  frames[1].contentWindow!.postMessage = message => { gridMessages.push(message); };
  let focus: (id: number) => void = () => {};
  let selection: number[] = [];
  function Harness({ viewer }: { viewer: ViewerDocument }) {
    const [selected, setSelected] = useState(new Set<number>());
    focus = useChemicalSpaceViewerSelection(collection, viewer, setSelected);
    selection = [...selected];
    return null;
  }
  const root = createRoot(document.getElementById("host")!);
  const receive = async (source: Window | null, index: number, sourcePath = subset.path) => act(async () => {
    window.dispatchEvent(new MessageEvent("message", { source, data: { source: "burette-viewer", body: {
      type: "chemicalSpaceMoleculeChanged", documentId: subset.id, sourceRecordId: index, sourcePath,
    } } }));
  });
  try {
    await act(async () => root.render(<Harness viewer={subset} />));
    expect(viewerMessages.at(-1).body.type).toBe("chemicalSpaceRequestSelection");
    focus(2);
    expect(viewerMessages.at(-1).body).toEqual({ type: "chemicalSpaceFocusMolecule", documentId: "subset", sourcePath: "/selected.sdf", sourceRecordId: 1 });
    await receive(frames[0].contentWindow as unknown as Window, 2);
    expect(selection).toEqual([41]);
    await receive(frames[1].contentWindow as unknown as Window, 0);
    expect(selection).toEqual([41]);
    await receive(frames[0].contentWindow as unknown as Window, 99);
    expect(selection).toEqual([]);
    focus(88);
    expect(gridMessages.at(-1).body).toEqual({ type: "chemicalSpaceOpenMolecule", documentId: "grid-a", sourceRecordId: 88, navigationDocumentId: "subset" });
    await act(async () => root.render(<Harness viewer={{ ...subset, path: "/scene.burette",
      dockingRequest: { receptorPath: "/receptor.pdb", ligandPaths: [subset.path] } }} />));
    focus(2);
    expect(viewerMessages.at(-1).body).toEqual({ type: "chemicalSpaceFocusMolecule",
      documentId: "subset", sourcePath: "/selected.sdf", sourceRecordId: 1 });
    await receive(frames[0].contentWindow as unknown as Window, 0);
    expect(selection).toEqual([9]);
    await act(async () => root.render(<Harness viewer={{ ...subset, moleculeSource: undefined, path: "/a.sdf" }} />));
    expect(selection).toEqual([]);
    await receive(frames[0].contentWindow as unknown as Window, 2, "/b.sdf");
    expect(selection).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  }
});

test("a newer map point cancels a previous row lookup before opening the structure", async () => {
  const source = readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");
  const start = source.indexOf("      if (body.type === 'chemicalSpaceOpenMolecule') {");
  const end = source.indexOf("      if (body.type === 'chemicalSpaceRequestState')", start);
  const state = { dataToken: 1, chemicalSpaceOpenToken: 0 };
  const pending: Array<(row: { index: number }) => void> = [], opened: number[] = [];
  const handler = new Function("body", "state", "capabilities", "config", "chemicalSpaceRow",
    "requestSingleMolstarDocument", "setStatus", source.slice(start, end));
  for (const index of [4, 9]) handler({ type: "chemicalSpaceOpenMolecule", sourceRecordId: index },
    state, () => ({ molstarOpen: true }), () => ({}),
    () => new Promise(resolve => pending.push(resolve as any)),
    (row: { index: number }) => opened.push(row.index), () => {});
  pending[1]({ index: 9 });
  pending[0]({ index: 4 });
  await Promise.resolve();
  expect(opened).toEqual([9]);
});

test("runtime maps a multi-file pose by source path and local record, never global row position", async () => {
  const source = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
  const start = source.indexOf("  function notifyChemicalSpaceMolecule(");
  const end = source.indexOf("  function notifyDockingPoseChanged(", start);
  const messages: unknown[] = [], poses: number[] = [];
  const prepared = { kind: "docking", poseCount: 3, poses: [
    { sourcePath: "/a.sdf", poseIndex: 0 }, { sourcePath: "/a.sdf", poseIndex: 1 },
    { sourcePath: "/b.sdf", poseIndex: 0 },
  ] };
  const env = { activeMolstarPrepared: prepared, activeConfig: { sourcePath: "/scene.burette" },
    readTrajectoryControlIndex: () => 2, postHostMessage: (body: unknown) => messages.push(body),
    activeStructurePoseSetter: async (index: number) => { poses.push(index); },
    setSdfPoseMode() {}, notifyStructureOverlayModeChanged() {},
  };
  const runtime = new Function(...Object.keys(env), `${source.slice(start, end)}; return { notifyChemicalSpaceMolecule, focusChemicalSpaceMolecule };`)(...Object.values(env));
  runtime.notifyChemicalSpaceMolecule();
  expect(messages).toEqual([{ type: "chemicalSpaceMoleculeChanged", sourcePath: "/b.sdf", sourceRecordId: 0 }]);
  for (const body of [{ sourcePath: "/b.sdf", sourceRecordId: 0 }, { sourcePath: "/a.sdf", sourceRecordId: 1 },
    { sourcePath: "/missing.sdf", sourceRecordId: 0 }, { sourcePath: "/a.sdf", sourceRecordId: 99 }]) {
    await runtime.focusChemicalSpaceMolecule(body);
  }
  expect(poses).toEqual([2, 1]);
});

test("point navigation is single-record; lasso and empty selections never switch the structure", () => {
  const source = readFileSync("apps/desktop/src/components/chemical-space-panel.tsx", "utf8");
  const start = source.indexOf("              onSelect={(sourceRecordIds) => {");
  const end = source.indexOf("              }}", start);
  const code = source.slice(start, end).split("=> {")[1];
  for (const [tool, ids, expected] of [["navigate", [2], [2]], ["navigate", [], []],
    ["lasso", [2], []], ["lasso", [9, 2, 41], []]] as const) {
    const focused: number[] = [], announced: unknown[] = [], selected: number[][] = [];
    new Function("sourceRecordIds", "tool", "GRID_SELECTION_BRIDGE_LIMIT", "setSelected", "postToGrid", "focusMolecule", code)(
      ids, tool, 100_000, (value: Set<number>) => selected.push([...value]),
      (body: unknown) => announced.push(body), (id: number) => focused.push(id));
    expect(focused).toEqual(expected);
    expect(selected).toEqual([[...ids]]);
    expect(announced).toEqual([{ type: "chemicalSpaceSelectionChanged", sourceRecordIds: [...ids],
      filterToSelection: tool === "lasso", focusSourceRecordId: tool === "navigate" && ids.length === 1 ? ids[0] : null }]);
  }
});

test("opening an unloaded source row ignores filters and never substitutes a nearby record", async () => {
  const source = readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");
  const start = source.indexOf("  async function chemicalSpaceRow(");
  const end = source.indexOf("  async function postChemicalSpaceMoleculePreview(", start);
  const requests: unknown[] = [];
  const state = { remoteMode: true, rows: [{ index: 99 }], all: [] };
  const hostRequest = async (type: string, body: unknown) => { requests.push({ type, body }); return { rows: [{ index: 4, name: "target" }] }; };
  const row = new Function("state", "hostRequest", `${source.slice(start, end)}; return chemicalSpaceRow;`)(state, hostRequest);
  expect(await row(4)).toEqual({ index: 4, name: "target" });
  expect(await row(5)).toBeNull();
  expect(requests[0]).toEqual({ type: "gridFetchPage", body: { query: "", sort: "index", columnFilters: [],
    descriptorFilters: [], analysisFilters: [], descriptorSort: null, offset: 4, limit: 1 } });
});

test("a delayed map open cannot replace a file the user switched to", async () => {
  const { useAppSdfViewerMessages } = await import("../apps/desktop/src/hooks/use-app-sdf-viewer-messages");
  const opened: unknown[] = [];
  const docked: any[][] = [];
  const receptor = { id: "protein", path: "/receptor.pdb", renderer: "molstar" } as ViewerDocument;
  let finish: (document: ViewerDocument) => void = () => {};
  let handle: (body: Record<string, unknown>) => Promise<boolean>;
  function Harness({ active }: { active: ViewerDocument }) {
    handle = useAppSdfViewerMessages({ activeDocument: active, documents: [collection, other, receptor],
      openBrowserDevTextDocument: () => new Promise(resolve => { finish = resolve; }),
      openDocumentsInActiveTab: docs => opened.push(docs), addDocuments: docs => opened.push(docs),
      preferences: {}, rememberRecentStructures() {}, pushStatus() {}, pushErrorStatus() {},
      openDockingDocument: (...args: any[]) => { docked.push(args); }, openDocuments() {}, openPoseReviewWorkspace() {}, setPoseReviewSelections() {},
    } as any).handleSdfViewerMessage;
    return null;
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness active={collection} />));
    const pending = handle!({ type: "openSdfMolstarDocument", documentId: collection.id,
      navigationDocumentId: collection.id, sourceRecordIds: [4], openTarget: "active-tab", textBase64: btoa("molecule") });
    await act(async () => root.render(<Harness active={other} />));
    finish(subset);
    await pending;
    expect(opened).toEqual([]);
    await act(async () => root.render(<Harness active={collection} />));
    const withReceptor = handle!({ type: "openSdfMolstarDocument", documentId: collection.id,
      navigationDocumentId: collection.id, sourceRecordIds: [4], receptorPath: receptor.path,
      textBase64: btoa("molecule") });
    finish({ ...subset });
    await withReceptor;
    expect(docked[0].slice(0, 2)).toEqual([receptor.path, [subset.path]]);
    expect(docked[0][2].moleculeSource).toEqual({ documentId: collection.id, path: collection.path, sourceRecordIds: [4] });
    expect(docked[0][2].shouldApply()).toBe(true);
    await act(async () => root.render(<Harness active={other} />));
    expect(docked[0][2].shouldApply()).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
