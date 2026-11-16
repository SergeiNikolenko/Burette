import React from "react";
import { createRoot } from "react-dom/client";
import { act, expect, test, browser, pickerFixture, settle, documents, useMoleculeStore, scientificStateFor, readBrowserScientificAttachment, readBrowserSourceCheckpoint } from "./mcd-picker-fixture";
import { useAppOpenActions } from "../apps/desktop/src/hooks/use-app-open-actions";
import { sidebarCreationItems } from "../apps/desktop/src/components/sidebar/context-actions";
import { buildSidebarProjects } from "../apps/desktop/src/lib/sidebar-projects";
import { readBrowserImport } from "../apps/desktop/src/lib/browser-import-storage";
import { registerDroppedBrowserFiles } from "../apps/desktop/src/lib/web-demo-workspace";
import { releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const mcd = "10000 -2.25 .12\r\n12000 1.5 .25\r\n";
test("durable scientific import enters real Recent and Palette data; a fresh chooser import stays distinct and Recent restores exact MCD", async () => {
 const f = await pickerFixture("mcd-reachable.fchk", "owner");
 const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
 try {
  const recent = useMoleculeStore.getState().recentStructures.find(value => value.path === f.doc.path);
  expect(recent).toBeDefined();
  await f.choose(new File([mcd], "authored.mcd")); await settle(() => Boolean(f.host.querySelector('table[aria-label="MCD source values"]')));
  const receipt = (await readBrowserScientificAttachment(f.doc.path))!, original = (await readBrowserImport(f.doc.path))!;
  const picked = await registerDroppedBrowserFiles([new File([original.file], original.name)], 16 * 1024 * 1024);
  expect(picked.errors).toEqual([]); expect(picked.paths).toHaveLength(1); expect(picked.paths[0]).not.toBe(f.doc.path);
  await act(async () => { await f.page.api.openPaths(picked.paths); });
  const duplicate = useMoleculeStore.getState().documents.find(value => value.path === picked.paths[0])!;
  const duplicateText = documents.readBrowserDevVirtualTextDocument(duplicate.path)!;
  expect(scientificStateFor(duplicate.id, duplicateText).revision!.document.frames.some(frame => frame.mcdCompanion)).toBe(false);
  expect(await readBrowserScientificAttachment(duplicate.path)).toBeNull();
  expect((await readBrowserScientificAttachment(f.doc.path))!.id).toBe(receipt.id);
  await act(async () => {
   useMoleculeStore.getState().closeDocument(f.doc.id);
   releaseClosedImports(new Set(useMoleculeStore.getState().documents.map(value => value.id)));
   documents.deleteBrowserDevVirtualTextDocument(f.doc.path);
  });
  const state = useMoleculeStore.getState();
  const projects = buildSidebarProjects({ documents: state.documents, recentStructures: state.recentStructures, projectRoots: [], activeDocumentId: state.activeDocumentId });
  const paletteItem = projects.flatMap(project => project.items).find(item => item.path === f.doc.path);
  expect(paletteItem?.source).toBe("recent"); expect(paletteItem?.documentId).toBeNull();
  let actions!: ReturnType<typeof useAppOpenActions>; const errors: unknown[] = [];
  function Probe() { actions = useAppOpenActions({ openPaths: f.page.api.openPaths, openStructureRecords: async () => [], pushErrorStatus: error => errors.push(error), pushStatus() {}, recentStructures: state.recentStructures }); return null; }
  await act(async () => { root.render(<Probe />); });
  const menu = sidebarCreationItems({ recentStructures: state.recentStructures, sidebarProjects: projects, expandedProjectIds: [] } as unknown as ShellViewState, actions as unknown as ShellActions);
  const submenu = menu.find(item => item.kind === "submenu" && item.id === "recent-files");
  if (submenu?.kind !== "submenu") throw new Error("The real Open recent route is missing");
  const index = state.recentStructures.findIndex(value => value.path === f.doc.path), item = submenu.items.find(value => value.kind === "item" && value.id === `recent-file-${index}`);
  if (item?.kind !== "item" || !item.action) throw new Error("The original imported path is absent from Open recent");
  await act(async () => { item.action!(); });
  await settle(() => Boolean(f.host.querySelector('table[aria-label="MCD source values"]')));
  const reopened = useMoleculeStore.getState().documents.find(value => value.path === f.doc.path)!;
  expect(reopened).not.toBe(f.doc); expect(documents.readBrowserDevVirtualTextDocument(reopened.path)).toBe(receipt.text);
  expect(scientificStateFor(reopened.id, receipt.text).revision!.document).toEqual(receipt.science);
  expect(await scientificStateFor(reopened.id, receipt.text).companions![0].file.text()).toBe(mcd);
  expect(new Uint8Array(await scientificStateFor(reopened.id, receipt.text).original!.file.arrayBuffer())).toEqual(new Uint8Array(await original.file.arrayBuffer()));
  expect(f.source.sessionForDocument(reopened)).toBeNull(); expect(await readBrowserSourceCheckpoint(reopened.path)).toBeNull(); expect(errors).toEqual([]);
 } finally { await act(async () => root.unmount()); host.remove(); await f.close(); }
});

test("Recent still excludes generic virtual, unregistered scientific paths and temporary paths; native metadata remains unchanged", async () => {
 const f = await pickerFixture("mcd-recent-exclusions.fchk", "owner");
 try {
  const generic = { ...f.doc, id: "not-a-scientific-owner" };
  const unregistered = { ...f.doc, path: "/OpenedFiles/not-registered.fchk" };
  const transient = { ...f.doc, path: "/viewer/ketcher/not-durable.xyz" };
  const native = { ...f.doc, id: "native-existing-contract", virtual: false, path: "/data/real-native.xyz" };
  const before = useMoleculeStore.getState().recentStructures;
  await act(async () => useMoleculeStore.getState().rememberRecentStructures([generic, unregistered, transient]));
  expect(useMoleculeStore.getState().recentStructures).toEqual(before);
  await act(async () => useMoleculeStore.getState().rememberRecentStructures([native]));
  const remembered = useMoleculeStore.getState().recentStructures.find(value => value.path === native.path)!;
  expect({ path: remembered.path, title: remembered.title, extension: remembered.extension, renderer: remembered.renderer, byteCount: remembered.byteCount }).toEqual({ path: native.path, title: native.title, extension: native.extension, renderer: native.renderer, byteCount: native.byteCount });
 } finally { await f.close(); }
});
