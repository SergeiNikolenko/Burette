import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act, useRef } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLIFrameElement", "Node", "Event", "CustomEvent", "MessageEvent", "CSS", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { KetcherLocation } from "../apps/desktop/src/components/editor-area/page-kinds/ketcher";
import type { ShellViewState } from "../apps/desktop/src/components/types";
import type { MoleculeTab } from "../apps/desktop/src/stores/molecule-store";
import type { ViewerDocument } from "../apps/desktop/src/types";
const { createRoot } = await import("react-dom/client");
const follow = await import("../apps/desktop/src/components/ketcher/follow-active-molecule");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useWorkspacePanesStore } = await import("../apps/desktop/src/stores/workspace-panes-store");

const miniPdb = readFileSync(new URL("../samples/mini.pdb", import.meta.url), "utf8");
const grid = { id: "grid", path: "/moses-properties.csv", title: "moses-properties.csv", extension: "csv", renderer: "grid2d", runtimePath: "", byteCount: 4096 } as ViewerDocument;
const pdb = { id: "pdb", path: "/mini.pdb", title: "mini.pdb", extension: "pdb", renderer: "molstar", runtimePath: "", byteCount: miniPdb.length } as ViewerDocument;
const tab = (id: string, document: ViewerDocument): MoleculeTab => ({ id, location: { kind: "file", path: document.path, documentId: document.id }, back: [], forward: [] });
const ketcherTab = (location: KetcherLocation): MoleculeTab => ({ id: "ketcher", pane: "right", location, back: [], forward: [] });

test("source, size gate and draft signature mirror the viewer's Open in Ketcher rules", () => {
  expect(follow.ketcherFollowSource(tab("t", grid), [grid], { documentId: "grid", rowIndex: 3 }))
    .toEqual({ kind: "grid-row", key: "grid:grid:3", documentId: "grid", rowIndex: 3 });
  expect(follow.ketcherFollowSource(tab("t", grid), [grid], null)).toEqual({ kind: "grid-row", key: "grid:grid:selection", documentId: "grid" });
  expect(follow.ketcherFollowSource(tab("t", pdb), [pdb], null)?.kind).toBe("structure");
  expect(follow.ketcherFollowSource(tab("t", pdb), [{ ...pdb, byteCount: 600 * 1024 }], null)).toBeNull();
  expect(follow.ketcherFollowSource(tab("t", pdb), [{ ...pdb, extension: "xyz" }], null)).toBeNull();
  expect(follow.ketcherFollowableStructureText("pdb", miniPdb)).toBe(true);
  const record = "a\n  RDKit\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n$$$$\n";
  expect(follow.ketcherFollowableStructureText("sdf", record)).toBe(true);
  expect(follow.ketcherFollowableStructureText("sdf", record + record)).toBe(false);
  expect(follow.ketcherDraftSignature({ molfile: "x\n  Ketcher 11052614232D\n\n  1  0\nM  END" }))
    .toBe(follow.ketcherDraftSignature({ molfile: "x\n  Ketcher 11052615002D\n\n  1  0\nM  END" }));
});

function Harness({ location, state, imports }: { location: KetcherLocation; state: ShellViewState; imports: unknown[] }) {
  const clean = useRef(follow.ketcherDraftSignature({ ket: "imported row" }));
  follow.useKetcherFollowActiveMolecule({
    tabId: "ketcher", location, state, enabled: true, cleanDraftSignature: clean,
    importStructures: async (paths, fragments) => { imports.push({ paths, fragments }); },
  });
  return null;
}

test("a docked, untouched Ketcher follows the grid selection and the active structure", async () => {
  const frame = document.createElement("iframe");
  frame.className = "viewer-iframe";
  frame.dataset.documentId = "grid";
  frame.dataset.renderer = "grid2d";
  const sent: unknown[] = [];
  const gridWindow = { postMessage: (message: unknown) => sent.push(message) };
  Object.defineProperty(frame, "contentWindow", { value: gridWindow });
  document.body.append(frame);
  const imports: unknown[] = [];
  const root = createRoot(document.createElement("div"));
  let location: KetcherLocation = { kind: "ketcher" };
  const render = async (tabs: MoleculeTab[], activeTabId: string) => {
    const state = { tabs: [...tabs, ketcherTab(location)], activeTabId, documents: [grid, pdb] } as unknown as ShellViewState;
    await act(async () => {
      useMoleculeStore.setState({ tabs: state.tabs, activeTabId });
      useWorkspacePanesStore.getState().selectTab("main", tabs[0]!.id);
      root.render(<Harness location={location} state={state} imports={imports} />);
    });
  };
  const gridTab = tab("grid-tab", grid);
  const command = (rowIndex?: number) => ({ source: "burette-grid-host", body: { type: "gridMenuCommand", command: "structure.edit-in-ketcher", ...(rowIndex === undefined ? {} : { rowIndex }) } });
  const select = (rowIndex: number) => act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data: { source: "burette-grid", body: { type: "gridMenuStateChanged", documentId: "grid", selectedSourceIndexes: [rowIndex] } }, source: gridWindow as never }));
  });

  // Opening the empty dock tab asks the grid for its selected row.
  await render([gridTab], "ketcher");
  expect(sent).toEqual([command()]);

  // The user returns to the grid and selects another card: Ketcher follows it,
  // and the grid's reply does not move focus from the grid to Ketcher.
  await render([gridTab], "grid-tab");
  await select(4);
  expect(sent.at(-1)).toEqual(command(4));
  location = { kind: "ketcher", importRequestId: 1, importRequest: { id: 1, paths: [], fragments: [{ title: "row", text: "C", source: { kind: "grid-row", documentId: "grid", rowIndex: 4, title: "row", extension: "smi" } }] } };
  await render([gridTab], "ketcher");
  expect(useMoleculeStore.getState().activeTabId).toBe("grid-tab");

  // The imported row is still untouched, so the next selection replaces it.
  location = { ...location, draftKet: "imported row" };
  await render([gridTab], "grid-tab");
  await select(5);
  expect(sent.at(-1)).toEqual(command(5));

  // Edited sketches are never replaced.
  location = { ...location, draftKet: "user edit" };
  await render([gridTab], "grid-tab");
  await select(6);
  expect(sent.at(-1)).toEqual(command(5));

  // A cleared canvas follows the next molecule: a small PDB structure.
  location = { kind: "ketcher" };
  const fetched: string[] = [];
  globalThis.fetch = (async (url: string) => { fetched.push(url); return new Response(miniPdb); }) as typeof fetch;
  await render([tab("pdb-tab", pdb)], "pdb-tab");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(fetched).toEqual([`/__burette/read-file?path=${encodeURIComponent("/mini.pdb")}`]);
  expect(imports).toEqual([{ paths: [], fragments: [{ title: "mini.pdb", text: miniPdb }] }]);
  await act(async () => root.unmount());
});
