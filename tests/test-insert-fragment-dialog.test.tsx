import { expect, test } from "bun:test";
import { act } from "react";
import { browser, button, click, input, mount } from "./structure-controls-dom";
import type { FragmentSource } from "../apps/desktop/src/lib/molecular-workbench/fragment-source";
Object.assign(browser.HTMLElement.prototype, { scrollIntoView() {} });
const { InsertFragmentDialog } = await import("../apps/desktop/src/components/workbench/structure-edit/insert-fragment-dialog");

async function settle(ready: () => boolean) {
  for (let attempt = 0; attempt < 100 && !ready(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(ready()).toBe(true);
}

test("library search, selection and SMILES entry submit the chosen fragment for the selected atom", async () => {
  const inserted: FragmentSource[] = [], closed: boolean[] = [];
  const view = await mount(<InsertFragmentDialog open target="C2" busy={false} error={null} onInsert={fragment => inserted.push(fragment)} onOpenChange={open => closed.push(open)} />);
  try {
    const body = document.body;
    await settle(() => body.querySelectorAll("[cmdk-item]").length > 100);
    // The highlighted list item is the choice, as in the command palette.
    expect(body.querySelector("[cmdk-item][data-selected=true]")?.textContent).toBe("butyl");
    expect(body.textContent).toContain("Attach to");
    expect(body.textContent).toContain("C2");
    await input(body, "Search fragments", "propyl");
    const names = [...body.querySelectorAll("[cmdk-item]")].map(item => item.textContent);
    expect(names).toEqual(["iso-propyl", "propyl"]);
    await click([...body.querySelectorAll("[cmdk-item]")].find(item => item.textContent === "propyl")!);
    expect(button(body, "Insert").disabled).toBe(false);
    await click(button(body, "Insert"));
    expect(inserted).toEqual([{ source: "library", id: "alkanes/propyl" }]);
    await click(button(body, "SMILES"));
    expect(button(body, "Insert").disabled).toBe(true);
    await input(body, "SMILES", " *C(=O)O ");
    await click(button(body, "Insert"));
    expect(inserted.at(-1)).toEqual({ source: "smiles", smiles: "*C(=O)O" });
    await click(button(body, "Close"));
    expect(closed).toEqual([false]);
  } finally { await view.close(); }
});

test("without a single selected atom the fragment becomes a new molecule; errors and busy state are shown", async () => {
  const view = await mount(<InsertFragmentDialog open target={null} busy error="The fragment overlaps the structure at this atom. Choose another attachment atom." onInsert={() => {}} onOpenChange={() => {}} />);
  try {
    const body = document.body;
    expect(body.textContent).toContain("New molecule");
    expect(body.querySelector('[role="alert"]')?.textContent).toContain("overlaps");
    expect(body.querySelector('[aria-label="Inserting"]')).not.toBeNull();
  } finally { await view.close(); }
});
