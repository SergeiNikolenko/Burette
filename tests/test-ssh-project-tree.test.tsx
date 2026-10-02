import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { RemoteProject } = await import("../apps/desktop/src/components/ssh/ssh-project-tree");
const shellStub = { actions: { setStructureDragActive() {}, openPaths() {} } as never, state: { documents: [] } as never };

test("SSH expansion queues every requested folder and the root control collapses the tree", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; finish: () => void }> = [];
  globalThis.fetch = ((_url: unknown, options: RequestInit) => new Promise<Response>(resolve => {
    const { path } = JSON.parse(String(options.body));
    requests.push({ path, finish: () => resolve(new Response(JSON.stringify({
      root: "/data", path, entries: path === "." ? ["a", "b", "c", "d", "e"].map(name => ({ name, directory: true })) : [{ name: `${path}.pdb`, directory: false }],
    }), { headers: { "Content-Type": "application/json" } })) });
  })) as typeof fetch;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
  };
  try {
    await act(async () => { root.render(<RemoteProject project={{ id: "test", name: "Remote", host: "fixture", root: "/data" }} onOpen={() => {}} {...shellStub} />); });
    await click("Expand Remote");
    await act(async () => { requests[0].finish(); });
    await click("Expand a");
    await click("Expand b");
    await click("Expand c");
    expect(requests.map(request => request.path)).toEqual([".", "a"]);
    await act(async () => { requests[1].finish(); });
    expect(requests.map(request => request.path)).toEqual([".", "a", "b"]);
    await act(async () => { requests[2].finish(); });
    expect(requests.map(request => request.path)).toEqual([".", "a", "b", "c"]);
    await act(async () => { requests[3].finish(); });
    expect(container.textContent).toContain("b.pdb");
    expect(container.textContent).toContain("c.pdb");
    // A cached folder in the queue must not prevent later work from running.
    await click("Expand d");
    await click("Collapse a");
    await click("Expand a");
    await click("Expand e");
    await act(async () => { requests[4].finish(); });
    expect(requests.map(request => request.path)).toEqual([".", "a", "b", "c", "d", "e"]);
    await act(async () => { requests[5].finish(); });
    await click("Collapse Remote");
    expect(container.querySelector('[role="group"]')).toBeNull();
    await click("Expand Remote");
    expect(requests).toHaveLength(6);
    expect(container.textContent).toContain("a");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});

test("SSH subfolders cut short by the scan budget are searched again when opened", async () => {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    const { path } = JSON.parse(String(options.body));
    paths.push(path);
    const listing = path === "."
      ? { root: "/data", path, entries: [{ name: "a", directory: true }], truncated: false, partial: true, discovered: [{ root: "/data", path: "a", entries: [], truncated: true }] }
      : { root: "/data", path, entries: [{ name: "late.pdb", directory: false }], truncated: false, partial: false };
    return new Response(JSON.stringify(listing), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => { await act(async () => { container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(); }); };
  try {
    await act(async () => { root.render(<RemoteProject project={{ id: "test", name: "Remote", host: "fixture", root: "/data" }} onOpen={() => {}} {...shellStub} />); });
    await click("Expand Remote");
    expect(container.textContent).toContain("Some folders weren't fully searched. Open one to search it.");
    await click("Expand a");
    expect(paths).toEqual([".", "a"]);
    expect(container.textContent).toContain("late.pdb");
    expect(container.textContent).not.toContain("Search stopped");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});

test("dragging an SSH folder onto the app downloads its structures and opens them", async () => {
  const originalFetch = globalThis.fetch;
  const originalElementFromPoint = document.elementFromPoint;
  const downloads: string[] = [];
  globalThis.fetch = (async (url: unknown, options: RequestInit) => {
    const { path } = JSON.parse(String(options.body));
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
    if (String(url).endsWith("/preview")) {
      downloads.push(path);
      return json(`/cache/${path}`);
    }
    if (path === ".") return json({ root: "/data", path, entries: [{ name: "ligands", directory: true }] });
    return json({
      root: "/data", path, entries: [{ name: "poses", directory: true }],
      discovered: [{ root: "/data", path: "ligands/poses", entries: [{ name: "b.sdf", directory: false }], truncated: false }],
    });
  }) as typeof fetch;
  const opened: string[][] = [];
  const actions = { setStructureDragActive() {}, openPaths: (paths: string[]) => { opened.push(paths); } } as never;
  const shell = document.createElement("div"); shell.className = "app-shell";
  const stage = document.createElement("div"); shell.append(stage);
  const container = document.createElement("div"); shell.append(container); document.body.append(shell);
  document.elementFromPoint = () => stage as never;
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<RemoteProject project={{ id: "test", name: "Remote", host: "fixture", root: "/data" }} onOpen={() => {}} actions={actions} state={shellStub.state} />); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Expand Remote"]')!.click(); });
    const folder = container.querySelector('[role="treeitem"][aria-label="ligands"]')!;
    await act(async () => {
      folder.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      window.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: 300, clientY: 200 }));
      window.dispatchEvent(new MouseEvent("mouseup", { button: 0, clientX: 300, clientY: 200 }));
    });
    for (let attempt = 0; attempt < 50 && opened.length === 0; attempt += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(downloads).toEqual(["ligands/poses/b.sdf"]);
    expect(opened).toEqual([["/cache/ligands/poses/b.sdf"]]);
  } finally {
    await act(async () => root.unmount());
    shell.remove();
    document.elementFromPoint = originalElementFromPoint;
    globalThis.fetch = originalFetch;
  }
});

test("right-clicking SSH folders opens the same menu as their options button", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    const { path } = JSON.parse(String(options.body));
    return new Response(JSON.stringify({ root: "/data", path, entries: path === "." ? [{ name: "ligands", directory: true }] : [] }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const menuText = async (row: Element) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
    await act(async () => { row.dispatchEvent(event); });
    for (let attempt = 0; attempt < 50 && !document.querySelector('[role="menu"]'); attempt += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    const text = [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map(item => item.textContent?.trim());
    await act(async () => { document.querySelector(".radix-context-menu-mount")?.remove(); });
    return { prevented: event.defaultPrevented, text };
  };
  try {
    await act(async () => { root.render(<RemoteProject project={{ id: "test", name: "Remote", host: "fixture", root: "/data" }} onOpen={() => {}} {...shellStub} />); });
    const project = await menuText(container.querySelector('[role="treeitem"][aria-label="Remote"]')!);
    expect(project).toEqual({ prevented: true, text: ["Refresh", "Pin", "Edit…", "Section", "Connection color", "Remove project"] });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Expand Remote"]')!.click(); });
    const folder = await menuText(container.querySelector('[role="treeitem"][aria-label="ligands"]')!);
    expect(folder).toEqual({ prevented: true, text: ["Refresh folder", "Collapse folder", "Add as project", "Copy path", "Delete folder from server…"] });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});
