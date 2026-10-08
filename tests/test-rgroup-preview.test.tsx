import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import result from "../apps/desktop/dev/rgroup-example-data.json";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLSelectElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("../apps/desktop/src/lib/derived-columns", () => ({
  loadDerivedEngines: async () => ({ rdkit: { get_mol: () => null } }),
}));
const { createRoot } = await import("react-dom/client");
const { RGroupPreviewResults } = await import("../apps/desktop/src/components/rgroup-preview");
const button = (mount: Element, name: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === name)!;

test("substituent pagination preserves counts and resets when a different series is chosen", async () => {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const other = { ...result.series[0], id: "S2", labels: [], matchedRows: 1 };
  try {
    await act(async () => root.render(<RGroupPreviewResults result={{ ...result, series: [...result.series, other] }} total={8} />));
    expect(Array.from(mount.querySelectorAll("figure [role=img]")).map(el => el.getAttribute("aria-label"))).toEqual([
      "Br[*:1]", "C[*:1]", "CC[*:1]", "CCC[*:1]", "Cl[*:1]", "F[*:1]",
    ]);
    expect([button(mount, "Previous").disabled, button(mount, "Next").disabled, mount.querySelector('[role="status"]')?.textContent]).toEqual([true, false, "1–6 of 8"]);
    await act(async () => button(mount, "Next").click());
    expect(Array.from(mount.querySelectorAll("figure [role=img]")).map(el => el.getAttribute("aria-label"))).toEqual(["N[*:1]", "O[*:1]"]);
    expect([button(mount, "Next").disabled, mount.querySelector('[role="status"]')?.textContent]).toEqual([true, "7–8 of 8"]);
    const select = mount.querySelector<HTMLSelectElement>('select[name="series"]')!;
    await act(async () => { select.value = "S2"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect([mount.querySelectorAll("figure").length, mount.textContent?.includes("No variable substituents")]).toEqual([0, true]);
    await act(async () => { select.value = "S1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("1–6 of 8");
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("an empty result has no invented coverage or molecular images", async () => {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<RGroupPreviewResults result={{ ...result, rows: [], series: [] }} total={0} />));
    expect(mount.textContent).toBe("0 / 0 matched");
    expect(mount.querySelectorAll('[role="img"]').length).toBe(0);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
