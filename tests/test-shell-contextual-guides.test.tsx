import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ContextualGuideRequest } from "../apps/desktop/src/components/onboarding/request";
import type { MenuItemSpec } from "../apps/desktop/src/components/menu-types";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { TextFileDocument, ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window({ url: "http://localhost/" });
for (const key of ["CSS", "window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLSelectElement", "HTMLIFrameElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Native menus, renderers and the Ketcher runtime are replaced by stand-ins;
// each trigger is driven through the control the user actually uses.
let menu: MenuItemSpec[] = [];
mock.module("../apps/desktop/src/components/native-context-menu", () => ({ showNativeContextMenu: async (items: MenuItemSpec[]) => { menu = items; return true; } }));
const viewerFrame = await import("../apps/desktop/src/components/editor-area/viewer-frame");
mock.module("../apps/desktop/src/components/editor-area/viewer-frame", () => ({ ...viewerFrame, ViewerFrame: () => null }));
mock.module("../apps/desktop/src/components/xyzrender-orientation-panel", () => ({ XyzrenderOrientationPanel: () => null }));
const folderFiles = ["/set/a.pdb", "/set/b.cif"];
mock.module("../apps/desktop/src/lib/browser-dev-startup", () => ({ scanBrowserDevFolders: async () => ({ files: folderFiles, truncated: false }) }));
const editorApi = new Proxy({}, {
  get: (_, key) => key === "then" ? undefined : String(key).startsWith("subscribe") ? () => () => {}
    : key === "getZoom" ? () => 1 : key === "getSelectedAtomIndexes" ? () => [] : () => Promise.resolve(""),
});
mock.module("../apps/desktop/src/components/ketcher-editor", () => ({
  loadKetcherRuntime: async () => {},
  KetcherEditor: ({ onReady }: { onReady: (api: unknown) => void }) => { React.useEffect(() => onReady(editorApi), [onReady]); return null; },
}));

const { createRoot } = await import("react-dom/client");
const { contextualGuideRequestEvent, registerContextualGuideHost } = await import("../apps/desktop/src/components/onboarding/request");
const { releaseContextualGuide, saveOnboardingProgress } = await import("../apps/desktop/src/components/onboarding/progress");
const { KetcherPage } = await import("../apps/desktop/src/components/ketcher-page");
const { XyzrenderAnimationDialog } = await import("../apps/desktop/src/components/xyzrender-animation-dialog");
const { TextFileViewer } = await import("../apps/desktop/src/components/text-file-viewer");
const { DockPanel } = await import("../apps/desktop/src/components/dock-panel");
const { DockFileTabs } = await import("../apps/desktop/src/components/dock-file-tabs");
const { workspaceFileMenu } = await import("../apps/desktop/src/components/workspace-file-menu");
const { FolderOpenDialog } = await import("../apps/desktop/src/components/folder-open-dialog");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");

let requests: ContextualGuideRequest[] = [];
let unregister: () => void;
let mount: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const collect = (event: Event) => requests.push((event as CustomEvent<ContextualGuideRequest>).detail);
const ids = () => requests.map(request => request.id);
const calls: unknown[][] = [];
const actions = new Proxy({}, { get: (_, name) => (...args: unknown[]) => { calls.push([name, ...args]); } }) as ShellActions;
const render = (node: React.ReactNode) => act(async () => root.render(node));
const frame = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });

async function waitFor<T>(read: () => T | null | undefined | false, message: string): Promise<T> {
  const deadline = Date.now() + 4000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(message);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
}

beforeEach(() => {
  localStorage.clear();
  saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
  requests = []; menu = []; calls.length = 0;
  unregister = registerContextualGuideHost();
  window.addEventListener(contextualGuideRequestEvent, collect);
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  document.body.innerHTML = "";
  for (const request of requests) releaseContextualGuide(request.id);
  window.removeEventListener(contextualGuideRequestEvent, collect);
  unregister();
  localStorage.clear();
});

const molecule = (id: string, extension = "pdb") => ({ id, title: `${id}.${extension}`, path: `/${id}.${extension}`, extension, renderer: "molstar", runtimePath: "<html></html>", byteCount: 10 }) as ViewerDocument;

test("Ketcher introduces itself once the editor is ready in the active tab", async () => {
  const state = { preferences: defaultPreferences, rightDockOpen: false, documents: [], textDocuments: [], sidebarProjects: [] } as unknown as ShellViewState;
  const page = (isActive: boolean) => <KetcherPage tabId="ketcher-guide" location={{ kind: "ketcher" }} state={state} actions={actions} isActive={isActive} />;
  await render(page(false));
  await frame();
  expect(requests).toEqual([]);
  await render(page(true));
  await waitFor(() => requests.length, "Ketcher never requested its guide");
  expect(requests).toEqual([{ id: "ketcher", anchor: null }]);
});

test("the XYZRender editor guide points at its launch control when the editor opens", async () => {
  const launch = document.createElement("button"); launch.className = "xyzrender-editor-launch";
  const controls = document.createElement("div"); controls.id = "xyzrender-editor-controls";
  document.body.append(launch, controls);
  await render(<XyzrenderAnimationDialog />);
  expect(requests).toEqual([]);
  const open = () => act(async () => { window.dispatchEvent(new CustomEvent("burette:xyzrender-animation", { detail: { documentId: "caffeine", label: "caffeine.xyz", previewSvg: "<svg/>", path: "/caffeine.xyz", preset: "default", controls: {} } })); });
  await open();
  await waitFor(() => requests.length, "Opening the editor never requested its guide");
  expect(requests).toEqual([{ id: "xyz-editor", anchor: launch }]);
  releaseContextualGuide("xyz-editor");
  await open(); await frame();
  expect(ids()).toEqual(["xyz-editor"]);
});

test("Edit source explains editing after the session opens, never for a restored session", async () => {
  const text = { id: "ligand", title: "ligand.pdb", path: "/ligand.pdb", extension: "pdb", content: "ATOM      1  C   LIG A   1       0.000   0.000   0.000  1.00  0.00           C\nEND\n", byteCount: 82, truncated: false } as TextFileDocument;
  const editing = (editable: boolean, onBeginEditing?: () => void) => ({ editable, content: text.content, status: editable ? "Saved" : "Read Only", dirty: false, saving: false, onBeginEditing });
  let begun = 0;
  await render(<TextFileViewer document={text} sourceEditing={editing(true)} />);
  await render(<TextFileViewer document={text} sourceEditing={editing(false, () => { begun += 1; })} />);
  await render(<TextFileViewer document={text} sourceEditing={editing(true)} />);
  expect(requests).toEqual([]);
  await render(<TextFileViewer document={text} sourceEditing={editing(false, () => { begun += 1; })} />);
  const button = [...mount.querySelectorAll("button")].find(item => item.textContent === "Edit source")!;
  await act(async () => button.click());
  expect(begun).toBe(1);
  expect(requests).toEqual([]);
  await render(<TextFileViewer document={text} sourceEditing={editing(true)} />);
  expect(requests).toEqual([{ id: "source-edit", anchor: mount.querySelector(".text-file-toolbar") }]);
});

test("opening a structure's text in a dock points at the Text tab or the file tab", async () => {
  const a = molecule("a");
  const state = {
    documents: [a], textDocuments: [], activeDocument: a, activeTab: { location: { kind: "file", path: a.path, documentId: a.id } },
    rightDockTabs: [{ id: "text", kind: "text" }, { id: "files", kind: "files" }], bottomDockTabs: [{ id: "files", kind: "files" }],
    rightDockActiveTab: "files", bottomDockActiveTab: "files", rightDockOpen: true, bottomDockOpen: true,
    rightDockDocumentId: null, bottomDockDocumentId: null, rightDockTool: null, bottomDockTool: null,
    dockDroppedStructures: [], hoveredGridRows: {}, visibleDocuments: [a], quickLookDocument: null, preferences: defaultPreferences,
  } as unknown as ShellViewState;
  const tab = (label: string) => mount.querySelector<HTMLButtonElement>(`.dock-header [role="tab"][aria-label="${label}"]`)!;
  await render(<DockPanel area="right" state={state} actions={actions} />);
  await act(async () => tab("Files").click()); await frame();
  expect(requests).toEqual([]);
  await act(async () => tab("Text").click()); await frame();
  expect(calls).toContainEqual(["setDockActiveTab", "right", "text"]);
  expect(requests).toEqual([{ id: "source-dock", anchor: tab("Text") }]);

  // A Text tab added from the dock menu is the anchor once it exists.
  localStorage.clear(); saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
  releaseContextualGuide("source-dock"); requests = [];
  const withoutText = { ...state, rightDockTabs: [{ id: "files", kind: "files" }] } as ShellViewState;
  await render(<DockPanel area="right" state={withoutText} actions={actions} />);
  await act(async () => mount.querySelector<HTMLButtonElement>('[aria-label="Add right dock tab"]')!.click());
  const addText = menu.find(item => item.kind === "item" && item.id === "dock-right-text");
  await act(async () => { if (addText?.kind === "item") addText.action?.(); root.render(<DockPanel area="right" state={state} actions={actions} />); });
  await frame();
  expect(requests).toEqual([{ id: "source-dock", anchor: tab("Text") }]);

  // Files → view options → Text in the bottom dock anchors to that file's tab.
  localStorage.clear(); saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
  releaseContextualGuide("source-dock"); requests = [];
  const entries = [{ key: "a", kind: "document" as const, documentId: a.id, title: a.title, detail: "", path: a.path }];
  await render(<DockFileTabs area="bottom" entries={entries} activeKey="a" textViews={{}} onTextView={() => {}} actions={actions} state={state} />);
  await act(async () => mount.querySelector<HTMLButtonElement>('[aria-label="View options for a.pdb"]')!.click());
  expect(requests).toEqual([]);
  const showText = menu.find(item => item.kind === "item" && item.id === "dock-file-text");
  await act(async () => { if (showText?.kind === "item") showText.action?.(); });
  expect(requests).toEqual([{ id: "source-dock", anchor: mount.querySelector(".dock-tab-shell") }]);
});

test("Open → As shows the view comparison after the file opens, only when both views exist", async () => {
  const workflows = { sceneTargets: () => [], gridView() {}, copyNames() {} } as unknown as Parameters<typeof workspaceFileMenu>[3];
  const state = { documents: [], pinnedStructurePaths: [] } as unknown as ShellViewState;
  const flatten = (items: MenuItemSpec[]): MenuItemSpec[] => items.flatMap(item => item.kind === "submenu" ? [item, ...flatten(item.items)] : [item]);
  const option = (path: string, id: string) => {
    const found = flatten(workspaceFileMenu([path], state, actions, workflows, [], action => action, () => {})).find(item => item.kind === "item" && item.id === id);
    return found?.kind === "item" ? found.action! : null;
  };
  expect(option("/ligand.mol2", "open-xyzrender")).toBeNull();
  await option("/ligand.mol2", "open-3d")!();
  expect(requests).toEqual([]);
  await option("/caffeine.xyz", "open-xyzrender")!();
  expect(calls).toContainEqual(["openStructurePaths", ["/caffeine.xyz"], { rendererMode: "xyzrender-external" }]);
  expect(requests).toEqual([{ id: "view-modes", anchor: null }]);
});

test("In one scene for a folder explains watching once the scene opens", async () => {
  const opened: unknown[][] = [];
  const state = { buildInfo: { isBrowserDev: true }, sidebarProjects: [] } as unknown as ShellViewState;
  const workflows = { sceneTargets: () => [] } as unknown as React.ComponentProps<typeof FolderOpenDialog>["workflows"];
  function Harness({ mode }: { mode: string }) {
    const [path, setPath] = React.useState<string | null>("/set");
    return <FolderOpenDialog path={path} initialMode={mode} state={state} actions={actions} workflows={workflows} progress={null} cancelBatch={() => {}}
      openBatch={(async (...args: unknown[]) => { opened.push(args); }) as unknown as React.ComponentProps<typeof FolderOpenDialog>["openBatch"]} onClose={() => setPath(null)} />;
  }
  const submit = () => act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await render(<Harness key="tabs" mode="tabs" />);
  await waitFor(() => document.querySelector("form button[type=submit]:not([disabled])"), "Folder contents never loaded");
  await submit();
  expect(opened.at(-1)?.[1]).toBe("tabs");
  expect(requests).toEqual([]);
  await render(<Harness key="together" mode="together" />);
  await waitFor(() => document.querySelector("form button[type=submit]:not([disabled])"), "Folder contents never loaded");
  expect(document.body.textContent).toContain("Add new files as they appear");
  expect(requests).toEqual([]);
  await submit();
  expect(opened.at(-1)).toEqual([folderFiles, "scene", undefined]);
  expect(requests).toEqual([{ id: "folder-watch", anchor: null }]);
});
