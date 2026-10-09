import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { FoldingResultBundle } from "../apps/desktop/src/types";
import type { ShellActions } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { FoldingResultsPanel } = await import("../apps/desktop/src/components/folding-results-panel");

// Deliberately small UI data, not scientific prediction results.
const bundle: FoldingResultBundle = {
  rootPath: "/fixture", title: "Two models", source: "test backend", artifacts: [], warnings: [],
  models: [1, 2].map(index => ({
    id: `model-${index}`, title: `Model ${index}`, backend: "", modelIndex: index,
    structurePath: `/fixture/model-${index}.pdb`, structureTitle: `model-${index}.pdb`,
    metrics: [{ key: "ptm", label: "pTM", value: index / 10, formatted: `0.${index}` }],
    artifacts: [
      { path: `/fixture/model-${index}.pdb`, title: `model-${index}.pdb`, extension: "pdb", kind: "structure", byteCount: 80 },
      { path: `/fixture/scores-${index}.json`, title: `scores-${index}.json`, extension: "json", kind: "scores", byteCount: 40 },
    ],
  })),
};

test("folding disclosure retains model state and routes file actions without toggling the section", async () => {
  const host = document.createElement("div"); host.className = "app-shell"; document.body.append(host);
  const root = createRoot(host);
  const calls: unknown[] = [];
  const actions = {
    openStructurePaths: (paths: string[]) => calls.push(["structure", paths]),
    openTextPaths: (paths: string[]) => calls.push(["text", paths]),
  } as unknown as ShellActions;
  const render = (next: FoldingResultBundle | null) => act(async () => root.render(
    <FoldingResultsPanel state={{ bundle: next, loading: false, error: null }} actions={actions} />,
  ));
  try {
    await render(bundle);
    const section = host.querySelector("details")!;
    expect(section.querySelector("summary")!.textContent).toBe("Folding results2 models");
    expect(host.textContent).not.toContain("test backend");
    const trigger = host.querySelector<HTMLElement>('[role="combobox"]')!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const choices = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(choices.map(choice => choice.textContent)).toEqual(["model 1", "model 2"]);
    await act(async () => choices[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(calls).toEqual([["structure", ["/fixture/model-2.pdb"]]]);
    const body = section.querySelector(".folding-results-body");
    await act(async () => { section.open = false; });
    await act(async () => { section.open = true; });
    expect(section.querySelector(".folding-results-body")).toBe(body);
    expect(trigger.textContent).toBe("model 2");
    expect(host.querySelector(".folding-model-summary span")!.textContent).toBe("model-2.pdb");
    for (const label of ["scoresscores-2.json", "structuremodel-2.pdb"]) {
      const button = Array.from(host.querySelectorAll("button")).find(button => button.textContent === label)!;
      await act(async () => button.click());
    }
    expect([section.open, calls]).toEqual([true, [
      ["structure", ["/fixture/model-2.pdb"]], ["text", ["/fixture/scores-2.json"]], ["structure", ["/fixture/model-2.pdb"]],
    ]]);
    await act(async () => { section.open = false; });
    await render({ ...bundle, rootPath: "/next-result" });
    expect([section.open, trigger.textContent]).toEqual([true, "model 1"]);
    await render(null);
    expect(host.textContent).toBe("");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
