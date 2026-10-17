import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useEffect, useState } from "react";
import type { Location } from "../apps/desktop/src/components/editor-area/page-kinds";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { MoleculeTab } from "../apps/desktop/src/stores/molecule-store";
import type { ShellViewState, ShellActions } from "../apps/desktop/src/components/types";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, localStorage: browser.localStorage });
const { createRoot } = await import("react-dom/client");
let mounted = 0, disposed = 0;
mock.module("../apps/desktop/src/components/editor-area/tab-router", () => ({
  TabMemoryRouter: ({ children }: { children: React.ReactNode }) => children,
  TabPageRoutes: ({ location, isActive }: { location: Location; isActive: boolean }) => {
    useEffect(() => { mounted++; return () => { disposed++; }; }, []);
    return <iframe data-path={"path" in location ? location.path : location.kind} data-playing={String(isActive)} />;
  },
}));
const { TabHistoryPages } = await import("../apps/desktop/src/components/editor-area/tab-history-pages");
const { useSceneEditProtection } = await import("../apps/desktop/src/components/editor-area/use-scene-edit-protection");

test("Back/Forward retains visited iframe and camera state, pauses hidden pages, bounds history and protects dirty grids", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const file = (name: string): Location => ({ kind: "file", path: `/${name}.xyz`, documentId: name });
  const a=file("a"), b=file("b"), c=file("c"), d=file("d");
  let tab: MoleculeTab = { id: "one", location: a, back: [], forward: [] };
  const state = { dirtyGridDocuments: new Set() } as unknown as ShellViewState;
  const render = async (active=true) => act(async () => root.render(<TabHistoryPages tab={tab} state={state} actions={{} as ShellActions} isActive={active} />));
  const frame = (name: string) => container.querySelector<HTMLIFrameElement>(`[data-path="/${name}.xyz"]`);
  try {
    await render(); const original=frame("a")!; original.dataset.camera="rotated-camera";
    tab={...tab,location:b,back:[a]}; await render();
    expect(original.closest("[hidden]")).not.toBeNull(); expect(original.dataset.playing).toBe("false");
    const mountedOrder = [...container.children];
    tab={...tab,location:a,back:[],forward:[b]}; await render();
    expect([...container.children]).toEqual(mountedOrder);
    expect(frame("a")).toBe(original); expect(original.dataset.camera).toBe("rotated-camera");
    expect(original.closest("[hidden]")).toBeNull(); expect(original.dataset.playing).toBe("true");
    tab={...tab,location:b,back:[a],forward:[]}; await render();
    expect(mounted).toBe(2); expect(disposed).toBe(0);
    tab={...tab,location:c,back:[a,b]}; await render();
    tab={...tab,location:d,back:[a,b,c]}; await render();
    expect(container.querySelectorAll("iframe").length).toBe(3); expect(frame("a")).toBeNull();
    state.dirtyGridDocuments!.add("b");
    await render(false);
    expect(container.querySelectorAll("iframe").length).toBe(2); expect(frame("b")).not.toBeNull();
    expect([...container.querySelectorAll("iframe")].every(el=>el.dataset.playing==="false")).toBe(true);
    state.dirtyGridDocuments!.clear(); await render(false);
    expect(container.querySelectorAll("iframe").length).toBe(1);
  } finally { await act(async()=>root.unmount()); container.remove(); }
});

test("a shared budget releases clean history but never the unsaved iframe", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const a: Location = { kind: "file", path: "/budget-a.pdb", documentId: "a" };
  const b: Location = { kind: "file", path: "/budget-b.pdb", documentId: "b" };
  let tab: MoleculeTab = { id: "budget", location: a, back: [], forward: [] };
  const state = { dirtyGridDocuments: new Set<string>(), documents: [] } as unknown as ShellViewState;
  let budget: ReadonlySet<string> | undefined;
  const render = () => act(async () => root.render(<TabHistoryPages tab={tab} state={state} actions={{} as ShellActions} isActive retainedHistoryKeys={budget} />));
  try {
    await render();
    const frame = container.querySelector("iframe");
    tab = { ...tab, location: b, back: [a] };
    await render();
    state.dirtyGridDocuments.add("a");
    budget = new Set();
    await render();
    expect(container.querySelector('[data-path="/budget-a.pdb"]')).toBe(frame);
    state.dirtyGridDocuments.clear();
    await render();
    expect(container.querySelectorAll("iframe").length).toBe(1);
    expect(container.querySelector('[data-path="/budget-a.pdb"]')).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("presentation edits protect path-only history even when its shared budget is empty", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const a: Location = { kind: "file", path: "/legacy-a.pdb" };
  const b: Location = { kind: "file", path: "/legacy-b.pdb", documentId: "b" };
  let tab: MoleculeTab = { id: "legacy", location: a, back: [], forward: [] };
  const state = { dirtyGridDocuments: new Set(), documents: [{ id: "a", path: a.path }, { id: "b", path: b.path }] } as unknown as ShellViewState;
  function Workspace() {
    const protectedIds = useSceneEditProtection(state.documents);
    return <TabHistoryPages tab={tab} state={state} actions={{} as ShellActions} isActive retainedHistoryKeys={new Set()} protectedDocumentIds={protectedIds} />;
  }
  try {
    await act(async () => root.render(<Workspace />));
    const original = container.querySelector("iframe");
    await act(async () => window.dispatchEvent(new browser.CustomEvent("burette:molstar-edit-history-changed", { detail: { documentId: "a", canUndo: true, canRedo: false } })));
    tab = { ...tab, location: b, back: [a] };
    await act(async () => root.render(<Workspace />));
    expect(container.querySelector('[data-path="/legacy-a.pdb"]')).toBe(original);
    // Undoing to the original coordinates still leaves redo state to preserve.
    await act(async () => window.dispatchEvent(new browser.CustomEvent("burette:molstar-edit-history-changed", { detail: { documentId: "a", canUndo: false, canRedo: true } })));
    expect(container.querySelector('[data-path="/legacy-a.pdb"]')).toBe(original);
    await act(async () => window.dispatchEvent(new browser.CustomEvent("burette:molstar-edit-history-changed", { detail: { documentId: "a", canUndo: false, canRedo: false } })));
    expect(container.querySelector('[data-path="/legacy-a.pdb"]')).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("paused admission keeps dirty history mounted and opens only after resume", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const a: Location = { kind: "file", path: "/paused-a.pdb", documentId: "a" };
  const b: Location = { kind: "file", path: "/paused-b.pdb", documentId: "b" };
  let tab: MoleculeTab = { id: "paused", location: a, back: [], forward: [] };
  const state = { dirtyGridDocuments: new Set(["a"]), documents: [] } as unknown as ShellViewState;
  function Workspace() {
    const [resumed, setResumed] = useState(false);
    const paused = tab.location === b && !resumed;
    return <TabHistoryPages tab={tab} state={state} actions={{} as ShellActions} isActive retainedHistoryKeys={new Set()}
      pausedPage={paused ? <div role="status">Scene paused<button onClick={() => setResumed(true)}>Open scene</button></div> : undefined} />;
  }
  try {
    await act(async () => root.render(<Workspace />));
    const original = container.querySelector("iframe");
    original!.dataset.unsaved = "preserved edit";
    tab = { ...tab, location: b, back: [a] };
    await act(async () => root.render(<Workspace />));
    expect(container.querySelectorAll("iframe").length).toBe(1);
    expect(container.querySelector('[data-path="/paused-a.pdb"]')).toBe(original);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Scene paused");
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
    expect(container.querySelector('[data-path="/paused-b.pdb"]')).not.toBeNull();
    expect(container.querySelector('[data-path="/paused-a.pdb"]')).toBe(original);
    expect(original!.dataset.unsaved).toBe("preserved edit");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test.each(["grid", "scene"])("branching after Back retains unsaved %s and restores its reachable history entry", async (kind) => {
  const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
  const originalState = useMoleculeStore.getState();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const a: Location = { kind: "file", path: "/branch-a.xyz", documentId: "a" };
  const b: Location = { kind: "file", path: "/branch-b.sdf", documentId: "b" };
  const c: Location = { kind: "file", path: "/branch-c.xyz", documentId: "c" };
  const state = { dirtyGridDocuments: new Set<string>(), documents: [] } as unknown as ShellViewState;
  function Workspace() {
    const tab = useMoleculeStore(store => store.tabs[0]);
    return <TabHistoryPages tab={tab} state={state} actions={{} as ShellActions} isActive />;
  }
  try {
    useMoleculeStore.setState({ tabs: [{ id: "branch", location: a, back: [], forward: [] }], activeTabId: "branch", documents: [] });
    await act(async () => root.render(<Workspace />));
    await act(async () => useMoleculeStore.getState().navigateTabLocation("branch", b, "push"));
    const original = container.querySelector<HTMLIFrameElement>('[data-path="/branch-b.sdf"]')!;
    original.dataset.unsaved = "edited cells";
    if (kind === "grid") state.dirtyGridDocuments = new Set(["b"]);
    else state.documents = [{ id: "b", sceneSourcePaths: ["/one.xyz", "/two.xyz"], sceneUnsaved: true } as ViewerDocument];
    await act(async () => useMoleculeStore.getState().navigateBack());
    await act(async () => useMoleculeStore.getState().navigateTabLocation("branch", c, "push"));
    expect(container.querySelector('[data-path="/branch-b.sdf"]')).toBe(original);
    expect(useMoleculeStore.getState().tabs[0].back).toEqual([b, a]);
    await act(async () => { useMoleculeStore.getState().navigateBack(); useMoleculeStore.getState().navigateBack(); });
    expect(useMoleculeStore.getState().tabs[0].location).toEqual(b);
    expect(original.closest("[hidden]")).toBeNull();
    expect(original.dataset.unsaved).toBe("edited cells");
  } finally {
    await act(async () => root.unmount()); container.remove();
    useMoleculeStore.setState(originalState);
  }
});
