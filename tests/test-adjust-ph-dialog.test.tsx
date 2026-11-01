import { expect, test } from "bun:test";
import { button, click, input, mount } from "./structure-controls-dom";
const { AdjustPhDialog } = await import("../apps/desktop/src/components/workbench/structure-edit/adjust-ph-dialog");

test("the pH dialog applies a pH from 0 to 14 and closes; other values are refused in place", async () => {
  const applied: number[] = [], open: boolean[] = [];
  const view = await mount(<AdjustPhDialog open onOpenChange={value => open.push(value)} onApply={pH => applied.push(pH)} />);
  try {
    const body = document.body;
    expect(body.querySelector<HTMLInputElement>('input[aria-label="pH"]')!.value).toBe("7.4");
    for (const value of ["15", "-1", ""]) {
      await input(body, "pH", value);
      expect([button(body, "Apply").disabled, body.querySelector('[role="alert"]')?.textContent]).toEqual([true, "Choose a pH from 0 to 14."]);
    }
    await input(body, "pH", "7.45");
    await click(button(body, "Apply"));
    expect([applied, open]).toEqual([[7.45], [false]]);
  } finally { await view.close(); }
});
