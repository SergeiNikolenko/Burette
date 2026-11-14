// The Enumerate Library dialog end to end: pasted building blocks, the product
// count before the run, the limit, and a run through the real enumeration
// worker that hands the shell one SDF collection.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { browser, button, click, input, mount } from "./structure-controls-dom";

// The source pickers are selects inside a form, which the select primitive looks up.
Object.defineProperty(globalThis, "HTMLFormElement", { configurable: true, value: browser.HTMLFormElement });

const { EnumerateLibraryDialogHost } = await import("../apps/desktop/src/components/workbench/enumerate-library-dialog-host");
const { openEnumerateLibrary } = await import("../apps/desktop/src/lib/library-enumeration-task");
const { parseSdfCollectionRecords } = await import("../apps/desktop/src/lib/collection-documents");
const { useWorkbenchDialogRequest } = await import("../apps/desktop/src/lib/workbench/dialog-store");

const fixture = (name: string) => readFileSync(new URL(`./fixtures/library-enumeration/${name}`, import.meta.url), "utf8");

async function paste(label: string, value: string) {
  const node = document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing text area: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const text = (selector: string) => [...document.body.querySelectorAll(selector)].map((node) => node.textContent?.trim());

async function until(done: () => boolean) {
  for (let attempt = 0; attempt < 200 && !done(); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  if (!done()) throw new Error("Timed out waiting for the library.");
}

function OpenState({ onChange }: { onChange: (open: boolean) => void }) {
  onChange(useWorkbenchDialogRequest()?.kind === "enumerate-library");
  return null;
}

async function openDialog() {
  const opened: Array<{ path: string; inputExtension: string; text: string }> = [];
  const statuses: string[] = [];
  let open = false;
  const view = await mount(<>
    <OpenState onChange={(value) => { open = value; }} />
    <EnumerateLibraryDialogHost
      actions={{ openStructureRecords: async (records) => { opened.push(...records); return [{ id: "library" }] as never; } }}
      onStatus={(message) => statuses.push(message)} />
  </>);
  await act(async () => openEnumerateLibrary(null));
  return { view, opened, statuses, isOpen: () => open };
}

test("pasted acids and amines show 12 products, then open as one collection of 12 amides", async () => {
  const { view, opened, statuses, isOpen } = await openDialog();
  try {
    expect(text('[role="group"] > span > span:first-child')).toEqual(["Reactant 1", "Reactant 2"]);
    expect(button(document.body, "Enumerate").disabled).toBe(true);

    await paste("Reactant 1 SMILES", fixture("acids.smi"));
    await paste("Reactant 2 SMILES", fixture("amines.smi"));
    expect(text('[role="group"] .workbench-value')).toEqual(["3 molecules", "4 molecules"]);
    expect(text('[data-slot="dialog-footer"] .workbench-value')).toEqual(["12 products"]);

    await click(button(document.body, "Enumerate"));
    await until(() => opened.length > 0 && !isOpen());
    expect(opened.map(({ path, inputExtension }) => ({ path, inputExtension }))).toEqual([{ path: "Amidation library.sdf", inputExtension: "sdf" }]);
    const records = parseSdfCollectionRecords(opened[0].text);
    expect(records.length).toBe(12);
    expect(records[11].props).toEqual({
      Reaction: "Amidation",
      "Reactant 1": "O=C(O)C1CC1",
      "Reactant 1 source": "cyclopropanecarboxylic acid",
      "Reactant 2": "NCc1ccccc1",
      "Reactant 2 source": "benzylamine",
    });
    expect(statuses).toEqual(["Enumerated 12 products"]);
  } finally { await view.close(); }
});

test("a library over the limit says so and cannot run; unfit building blocks are reported after the run", async () => {
  const { view, opened, statuses, isOpen } = await openDialog();
  try {
    await paste("Reactant 1 SMILES", "CC(=O)O\n".repeat(41));
    await paste("Reactant 2 SMILES", "CCN\n".repeat(49));
    expect(text('[data-slot="dialog-footer"] [role="alert"]')).toEqual(["2,009 products. A library holds up to 2,000."]);
    expect(button(document.body, "Enumerate").disabled).toBe(true);

    // Ethanol is no acid, and the second acetic acid repeats the first.
    await paste("Reactant 1 SMILES", "CC(=O)O\nCCO\nOC(C)=O");
    await paste("Reactant 2 SMILES", "CCN");
    expect(text('[data-slot="dialog-footer"] .workbench-value')).toEqual(["3 products"]);
    await click(button(document.body, "Enumerate"));
    await until(() => opened.length > 0 && !isOpen());
    expect(parseSdfCollectionRecords(opened[0].text).length).toBe(1);
    expect(statuses).toEqual(["Enumerated 1 product, 1 duplicate removed, 1 building block skipped"]);
  } finally { await view.close(); }
});

test("a core lists its R positions and a library nothing fits stays in the dialog", async () => {
  const { view, opened, isOpen } = await openDialog();
  try {
    await click(button(document.body, "Core"));
    expect(text('[role="group"] > span > span:first-child')).toEqual([]);
    await input(document.body, "Core", "c1ccccc1");
    expect(text('[role="alert"]')).toEqual(["Mark the attachment points in the core, for example [*:1]."]);
    await input(document.body, "Core", "[*:1]c1ccc([*:2])cc1");
    expect(text('[role="group"] > span > span:first-child')).toEqual(["R1", "R2"]);

    await paste("R1 SMILES", "C\nCl");
    await paste("R2 SMILES", fixture("r2.smi"));
    await click(button(document.body, "Enumerate"));
    await until(() => text('[role="alert"]').length > 0);
    expect(text('[role="alert"]')).toEqual(["No products. Each building block needs one attachment point, written *."]);
    expect([opened.length, isOpen()]).toEqual([0, true]);

    await paste("R1 SMILES", fixture("r1.smi"));
    await click(button(document.body, "Enumerate"));
    await until(() => opened.length > 0 && !isOpen());
    expect(opened[0].path).toBe("Core library.sdf");
    expect(parseSdfCollectionRecords(opened[0].text).map((record) => record.props.R1)).toEqual(
      ["C[*:1]", "C[*:1]", "C[*:1]", "Cl[*:1]", "Cl[*:1]", "Cl[*:1]"],
    );
  } finally { await view.close(); }
});
