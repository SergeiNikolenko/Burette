import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ChemicalEditorTarget } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { useChemicalEditorTargets } = await import("../apps/desktop/src/hooks/use-chemical-editor-targets");
const { onlineManager } = await import("@tanstack/react-query");

test("menus and settings share discovery, while late results stay with their own file", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const requests: string[] = [];
  const completions = new Map<string, (targets: ChemicalEditorTarget[]) => void>();
  const listTargets = (path: string) => {
    requests.push(path);
    return new Promise<ChemicalEditorTarget[]>(resolve => completions.set(path, resolve));
  };
  function Consumer({ path }: { path: string | null }) {
    const { targets, loading } = useChemicalEditorTargets(path, listTargets);
    return <output>{loading ? "Loading" : targets.map(target => target.name).join(",")}</output>;
  }
  const target = (name: string): ChemicalEditorTarget => ({ id: name, name, supportedExtensions: ["pdb"] });
  const settle = async (path: string, name: string) => {
    await act(async () => { completions.get(path)!([target(name)]); await new Promise(resolve => setTimeout(resolve, 10)); });
  };
  try {
    onlineManager.setOnline(false);
    await act(async () => { root.render(<><Consumer path="query-test-a.pdb" /><Consumer path="query-test-a.pdb" /></>); });
    expect(requests).toEqual(["query-test-a.pdb"]);
    expect(container.textContent).toBe("LoadingLoading");
    await act(async () => { root.render(<><Consumer path="query-test-b.pdb" /><Consumer path="query-test-b.pdb" /></>); });
    await settle("query-test-a.pdb", "Editor A");
    expect(container.textContent).toBe("LoadingLoading");
    await settle("query-test-b.pdb", "Editor B");
    expect(container.textContent).toBe("Editor BEditor B");
    await act(async () => { root.render(<><Consumer path="query-test-a.pdb" /><Consumer path={null} /></>); });
    expect(container.textContent).toBe("Editor A");
    expect(requests).toEqual(["query-test-a.pdb", "query-test-b.pdb"]);
  } finally {
    onlineManager.setOnline(true);
    await act(async () => root.unmount());
    container.remove();
  }
});
