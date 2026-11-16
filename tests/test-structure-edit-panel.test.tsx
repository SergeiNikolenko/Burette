import assert from "node:assert/strict";
import React, { act } from "react";
import { test } from "bun:test";
import { Fixture, source, doc, writes, viewerActions, session, rememberViewerAtomSelection, until, click, button,
  createHost, topologyFixture, metadataFixture, metadata, replaceSource } from "./structure-edit-fixture";
import { dockFixture } from "./structure-edit-dock-fixture";

test("edits one explicit SDF graph in place, rejects overvalence and undoes to the original text", async () => {
  const { host, root } = createHost();
  try {
    await act(async () => root.render(<Fixture />));
    await until(host, () => host.querySelectorAll("[data-atom]").length === 3, "the atom table");

    // The 3D selection drives the editor: two atoms show their bond.
    await act(async () => rememberViewerAtomSelection(doc.id, { atoms: 2, atomIdentities: [{ sourceIndex: 1, atomIndex: 1 }, { sourceIndex: 2, atomIndex: 2 }] }));
    await until(host, () => host.textContent.includes("C2–O3"), "the selected bond");

    // Clearing the selection in the view clears the editor's selection.
    await act(async () => rememberViewerAtomSelection(doc.id, null));
    await until(host, () => !host.textContent.includes("C2–O3") && !host.querySelector('[data-atom][aria-selected="true"]'), "the cleared selection");
    await act(async () => rememberViewerAtomSelection(doc.id, { atoms: 2, atomIdentities: [{ sourceIndex: 1, atomIndex: 1 }, { sourceIndex: 2, atomIndex: 2 }] }));
    await until(host, () => host.textContent.includes("C2–O3"), "the reselected bond");

    await click(button(host, "Double"));
    await until(host, () => writes.length === 1, "the double bond draft");
    const draft = writes[0].content;
    assert.deepEqual(writes[0].options, { view: "keep" });
    assert.equal(draft.split("\n")[0], "ethanol");
    assert.match(draft, /^M {2}V30 2 2 2 3$/mu);
    assert.match(draft, /> <ID>\nEtOH-1\n\n/u);

    // A triple C=O bond exceeds oxygen's valence: the error shows, the draft stays.
    await click(button(host, "Triple"));
    await until(host, () => host.querySelector('[role="alert"]')?.textContent.includes("valence"), "the valence error");
    assert.equal(writes.length, 1);

    await click(button(host, "Undo"));
    await until(host, () => writes.length === 2, "undo");
    assert.equal(writes[1].content, source);
    await click(button(host, "Redo"));
    await until(host, () => writes.length === 3, "redo");
    assert.equal(writes[2].content, draft);

    // A row picked in the panel is highlighted in the scene; Add bonds a new atom to it.
    await click(host.querySelector('[data-atom="0"]'));
    await until(host, () => viewerActions.at(-1)?.type === "preview_geometry" && (viewerActions.at(-1) as { atoms: number[] }).atoms.join() === "0", "the scene highlight");
    const element = host.querySelector('input[aria-label="Element to add"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(element, "N");
      element!.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await click(button(host, "Add"));
    await until(host, () => writes.length === 4, "the added atom");
    assert.match(writes[3].content, /^M {2}V30 4 N /mu);
    assert.match(writes[3].content, /^M {2}V30 \d+ 1 1 4$/mu);
    await until(host, () => host.querySelectorAll("[data-atom]").length === 4 && host.querySelector('[data-atom="3"]')?.getAttribute("aria-selected") === "true", "the new atom selected");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 30_000);

test("selection never outlives its snapshot: delete, add, undo and redo render without errors", async () => {
  const { Host, host, root, rows, selectedRows, step, errors } = topologyFixture();
  try {
    await act(async () => root.render(<Host />));
    await until(host, () => rows() === 3, "the atom table");
    await click(host.querySelector('[data-atom="1"]'));
    await click(host.querySelector('[data-atom="2"]'), { metaKey: true });
    await until(host, () => host.textContent.includes("C2–O3"), "the panel bond selection");
    await step("Double", 3);
    await step("Undo", 3);
    await step("Redo", 3);

    await click(host.querySelector('[data-atom="2"]'));
    await step("Move up", 3);
    assert.deepEqual(selectedRows(), ["1"], "the moved atom stays selected at its new position");
    await step("Delete atom", 2);
    assert.deepEqual(selectedRows(), []);

    await click(host.querySelector('[data-atom="1"]'));
    const element = host.querySelector('input[aria-label="Element to add"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(element, "N");
      element!.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await step("Add", 3);
    assert.deepEqual(selectedRows(), ["2"], "the added N3 is selected");

    // Undo removes N3: its selection belongs to the newer snapshot and must not render here.
    await step("Undo", 2);
    assert.deepEqual(selectedRows(), []);
    assert.equal(host.querySelector('section[aria-label^="Atom"]'), null);
    await step("Undo", 3);
    await step("Redo", 2);
    await step("Redo", 3);
    assert.deepEqual(errors, []);
    assert.ok(host.querySelector("table"), "the panel is still rendered");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 60_000);


test("metadata applies one snapshot-bound edit with Undo, Redo and selection invalidation", async () => {
  const { host, root, input, fill } = metadataFixture();
  try {
    await act(async () => root.render(<Fixture document={{ ...doc, id: "metadata-ui", path: "/metadata-ui.sdf" }} />));
    await until(host, () => input("Conformer label"), "metadata fields");
    await click(host.querySelector('[data-atom="0"]'));
    await fill("Conformer label", "Relaxed");
    await fill("Atom name", "CA");
    await fill("Residue name", "ALA");
    await fill("Residue sequence", "12");
    await fill("Chain", "A");
    await fill("Insertion code", "B");
    const before = writes.length;
    await click(button(host, "Apply metadata"));
    await until(host, () => writes.length === before + 1, "metadata applied");
    const applied = writes.at(-1)!.content;
    assert.equal(metadata(applied).conformer.label, "Relaxed");
    assert.deepEqual(metadata(applied).atoms[0].residue, { name: "ALA", sequence: 12, chain: "A", insertionCode: "B" });
    assert.equal(metadata(applied).atoms[0].atomName, "CA");
    await click(button(host, "Undo"));
    await until(host, () => writes.length === before + 2, "metadata undo");
    assert.equal(input("Conformer label")!.value, "");
    await click(button(host, "Redo"));
    await until(host, () => writes.length === before + 3, "metadata redo");
    assert.equal(writes.at(-1)!.content, applied);
    await click(host.querySelector('[data-atom="0"]'));
    await fill("Atom name", "UNSAVED");
    await click(host.querySelector('[data-atom="1"]'));
    assert.equal(input("Atom name")!.value, "");
    assert.equal(button(host, "Apply metadata").disabled, true);
    await click(host.querySelector('[data-atom="0"]'));
    await click(button(host, "Clear residue"));
    await click(button(host, "Apply metadata"));
    await until(host, () => writes.length === before + 4, "clear residue");
    assert.equal(metadata(writes.at(-1)!.content).atoms[0].residue, undefined);
    assert.equal(metadata(writes.at(-1)!.content).atoms[0].atomName, "CA");
    await fill("Conformer label", "STALE");
    await click(button(host, "Undo"));
    await until(host, () => input("Conformer label")!.value === "Relaxed", "stale fields invalidated by Undo");
    assert.equal(button(host, "Apply metadata").disabled, true);
    await click(host.querySelector('[data-atom="0"]'));
    await click(host.querySelector('[data-atom="1"]'), { shiftKey: true });
    assert.equal(input("Atom name"), null, "multiple selection never exposes an implicit bulk overwrite");
    await fill("Conformer label", "STALE SOURCE");
    await act(async () => { replaceSource(source); });
    await until(host, () => input("Conformer label")?.value === "", "external source replacement resets fields");
    assert.equal(button(host, "Apply metadata").disabled, true);
  } finally { await act(async () => root.unmount()); host.remove(); }
}, 60_000);


test("the dock store switches Edit to Text and back after metadata edits", async () => {
  const { host, root, Dock, tabId, useTabWorkspaceStore } = await dockFixture();
  try {
    await act(async () => root.render(<Dock />));
    await until(host, () => host.querySelector('input[aria-label="Conformer label"]'), "Edit loaded");
    const input = host.querySelector('input[aria-label="Conformer label"]');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "Dock conformer"); input!.dispatchEvent(new window.Event("input", { bubbles: true })); });
    await click(button(host, "Apply metadata"));
    await until(host, () => session?.content.includes("Dock conformer"), "metadata draft");
    await click(host.querySelector('[role="tab"][aria-label="Text"]'));
    assert.equal(useTabWorkspaceStore.getState().workspaces[tabId].right.activeTab, "text");
    await click(host.querySelector('[role="tab"][aria-label="Edit"]'));
    assert.equal(useTabWorkspaceStore.getState().workspaces[tabId].right.activeTab, "structure-edit");
    await until(host, () => host.querySelector<HTMLInputElement>('input[aria-label="Conformer label"]')?.value === "Dock conformer", "Edit restored");
    assert.equal(host.querySelector('[role="tab"][aria-label="Edit"]')!.getAttribute("aria-selected"), "true");
  } finally { await act(async () => root.unmount()); host.remove(); }
}, 60_000);
