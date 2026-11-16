import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act } from "react";
import ts from "typescript-compiler-api";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const observed = new Set<Element>();
let deliver: IntersectionObserverCallback;
let observerCount = 0;
Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: class {
  constructor(callback: IntersectionObserverCallback) { deliver = callback; observerCount++; }
  observe(row: Element) { observed.add(row); }
  unobserve(row: Element) { observed.delete(row); }
  disconnect() { observed.clear(); }
} });
const { createRoot } = await import("react-dom/client");
const { ProjectGroup } = await import("../apps/desktop/src/components/sidebar/file-tree-node");
const { TooltipProvider } = await import("../apps/desktop/src/components/ui/tooltip");
const { useFileSelection } = await import("../apps/desktop/src/components/sidebar/use-file-selection");

// Exercise the production DOM navigation against virtual and mounted rows.
const source = readFileSync("apps/desktop/src/components/sidebar/file-browser.tsx", "utf8");
const ast = ts.createSourceFile("file-browser.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const navigation = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleSidebarTreeKeyDown")!;
const selector = source.match(/const SIDEBAR_TREE_ROW_SELECTOR = .*;/)![0];
const code = ts.transpileModule(selector + "\n" + navigation.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const navigate = new Function(`${code}; return handleSidebarTreeKeyDown;`)();

test("large search keeps every navigation anchor while mounting only intersecting file controls", async () => {
  const opened: string[] = [];
  const project = {
    id: "project:test", rootPath: "/test", title: "test", isPinned: false, isActive: false,
    items: Array.from({ length: 1000 }, (_, index) => ({
      key: `${index}`, path: `/test/group/file-${index}.pdb`, title: `file-${index}.pdb`,
      relativePath: `group/file-${index}.pdb`, renderer: "molstar", extension: "pdb",
      source: "project", isPinned: false, isActive: false, isOpen: false, byteCount: 100,
    })),
  };
  const state = { sidebarProjects: [project], sidebarQuery: "test", expandedProjectIds: [], documents: [] } as unknown as ShellViewState;
  const actions = { setStructureDragActive() {}, openPaths: async (paths: string[]) => { opened.push(...paths); } } as unknown as ShellActions;
  let selection: ReturnType<typeof useFileSelection>;
  function Shell() {
    selection = useFileSelection();
    return <TooltipProvider><div className="sidebar-scroll"><div role="tree" onKeyDown={event => navigate(event, selection.select)}>
      <ProjectGroup project={project as never} state={state} actions={actions} />
    </div></div></TooltipProvider>;
  }
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  const rows = () => [...mount.querySelectorAll<HTMLElement>('[data-sidebar-structure-path]')];
  const visibility = (indexes: number[]) => deliver([...observed].map((target, index) => ({ target, isIntersecting: indexes.includes(index) })) as IntersectionObserverEntry[], {} as IntersectionObserver);
  try {
    await act(async () => root.render(<Shell />));
    expect(observerCount).toBe(1);
    expect(observed.size).toBe(1000);
    expect(rows()).toHaveLength(1000);
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(0);
    expect(mount.querySelector('[aria-label="group"]')).not.toBeNull();
    await act(async () => visibility([0, 1, 2, 3, 4]));
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(5);
    expect(rows()).toHaveLength(1000);
    await act(async () => {
      rows()[0].focus();
      selection.select(rows()[0].dataset.sidebarStructurePath!, { currentTarget: rows()[0], metaKey: false, ctrlKey: false, shiftKey: false });
    });
    state.structureDragActive = true;
    await act(async () => root.render(<Shell />));
    await act(async () => visibility([]));
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(5);
    state.structureDragActive = false;
    await act(async () => root.render(<Shell />));
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(1);
    await act(async () => visibility([0, 1, 2, 3, 4]));
    await act(async () => rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", shiftKey: true, bubbles: true })));
    expect((document.activeElement as HTMLElement).dataset.sidebarStructurePath).toBe(project.items.at(-1)!.path);
    expect(selection.selected.size).toBe(1000);
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(6);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(opened).toEqual([project.items.at(-1)!.path]);
    await act(async () => visibility([]));
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(1);
    expect(rows()).toHaveLength(1000);
    // Home reaches the real project header; leaving the file releases its mount.
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement?.classList.contains("project-group-row")).toBe(true);
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(0);
    // Focus + Enter in one event batch must not lose the activation during mount.
    await act(async () => {
      rows()[500].focus();
      rows()[500].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(opened.at(-1)).toBe(project.items[500].path);
    // Clearing the query restores the original closed-folder behavior.
    state.sidebarQuery = "";
    await act(async () => root.render(<Shell />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    expect(mount.querySelector('[data-sidebar-structure-path]')).toBeNull();
    expect(observed.size).toBe(0);
    state.sidebarQuery = "test";
    await act(async () => root.render(<Shell />));
    expect(rows()).toHaveLength(1000);
    expect(observed.size).toBe(1000);
    // Normal project browsing uses the same bounded controls after Show more.
    state.sidebarQuery = "";
    state.expandedProjectIds = [project.id];
    await act(async () => root.render(<Shell />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    expect(rows()).toHaveLength(5);
    expect(observed.size).toBe(5);
    const more = mount.querySelector<HTMLButtonElement>('[aria-label="Show 995 more files in group"]')!;
    expect(more).not.toBeNull();
    await act(async () => more.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    expect(rows()).toHaveLength(1000);
    expect(observed.size).toBe(1000);
    await act(async () => visibility([0, 1, 2]));
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(3);
    await act(async () => rows()[0].focus());
    await act(async () => rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect((document.activeElement as HTMLElement).dataset.sidebarStructurePath).toBe(project.items.at(-1)!.path);
    await act(async () => visibility([997, 998, 999]));
    expect(mount.querySelectorAll(".project-icon")).toHaveLength(3);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(opened.at(-1)).toBe(project.items.at(-1)!.path);
    const less = mount.querySelector<HTMLButtonElement>('[aria-label="Show fewer files in group"]')!;
    await act(async () => less.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    expect(rows()).toHaveLength(5);
    expect(observed.size).toBe(5);
  } finally {
    await act(async () => root.unmount()); mount.remove();
  }
  expect(observed.size).toBe(0);
});
