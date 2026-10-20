import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { NativeWorkspaceHome } = await import("../apps/desktop/src/components/welcome/native-workspace-home");
const { NativeWorkspaceSidebar } = await import("../apps/desktop/src/components/native-workspace-navigation");

test("Home reuses its page and keeps open structures available", async () => {
  const calls: string[] = [];
  const structure = { id: "protein", location: { kind: "file", path: "/samples/1htb.pdb" } };
  const home = { id: "home", location: { kind: "launcher" } };
  const state = { tabs: [structure, home], activeTab: structure, activeTabId: "protein", documents: [{ id: "protein", path: "/samples/1htb.pdb", title: "1htb.pdb" }] } as unknown as ShellViewState;
  const actions = {
    selectTab: (id: string) => calls.push(id), openNewTab: () => calls.push("new"), openKetcher: () => calls.push("ketcher"),
  } as unknown as ShellActions;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async () => { await act(async () => root.render(<NativeWorkspaceSidebar state={state} actions={actions} />)); };
  const click = async (name: string) => {
    const button = [...container.querySelectorAll("button")].find(button => button.textContent === name);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await render();
    await click("Recent files");
    await click("1htb.pdb");
    await click("Ketcher");
    expect(calls).toEqual(["home", "protein", "ketcher"]);
    expect(state.tabs).toHaveLength(2);
    state.tabs = state.tabs.filter(tab => tab.id !== "home");
    await render();
    await click("Recent files");
    expect(calls).toEqual(["home", "protein", "ketcher", "new"]);
    state.tabs.push({ id: "sketch", location: { kind: "ketcher", draftMolfile: "saved sketch" } });
    await render();
    await click("Ketcher");
    expect(calls.at(-1)).toBe("sketch");
    expect(container.querySelectorAll("button")).toHaveLength(3);
  } finally { await act(async () => root.unmount()); container.remove(); }
});


test("Recent files open by path, report failures, and keep Ketcher available", async () => {
  const opened: string[] = [];
  const actions = { openKetcher: () => opened.push("ketcher") } as unknown as ShellActions;
  const home = {
    recent: async () => [{ path: "/samples/a b.pdb", label: "a b.pdb", format: "pdb", openedAt: new Date().toISOString() }],
    open: async (link: string) => { opened.push(link); throw new Error("File no longer exists"); },
    search: async () => { throw new Error("Unexpected search"); },
    ask: async () => { throw new Error("Unexpected agent prompt"); },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<NativeWorkspaceHome actions={actions} home={home} />));
    const file = container.querySelector<HTMLButtonElement>('button[title="/samples/a b.pdb"]')!;
    await act(async () => file.click());
    expect(opened).toEqual(["/open?path=%2Fsamples%2Fa%20b.pdb"]);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not open this file. Try again.");
    expect(file.disabled).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>(".native-home-ketcher")!.click());
    expect(opened.at(-1)).toBe("ketcher");
    expect(container.querySelector("input")).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); }
});

type Home = React.ComponentProps<typeof NativeWorkspaceHome>["home"];
async function homeFixture(run: (mount: HTMLDivElement, render: (home: Home) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try { await run(mount, home => act(async () => root.render(<NativeWorkspaceHome actions={{ openKetcher: () => {} } as ShellActions} home={home} />))); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const recentFile = (label: string) => ({ path: `/samples/${label}`, label, format: "pdb", openedAt: "invalid timestamp" });
const homeStub = (patch: Partial<Home>): Home => ({ recent: async () => [], open: async () => {}, search: async () => [], ask: async () => {}, ...patch });
const namedButton = (mount: Element, name: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === name)!;

test("recent-file loading can retry without exposing raw errors or breaking on missing timestamps", async () => {
  await homeFixture(async (mount, render) => {
    let calls = 0;
    const home = homeStub({ recent: async () => { if (++calls === 1) throw new Error("Host internal /private/path"); return [recentFile("a.pdb")]; } });
    await render(home);
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not load recent files.");
    expect(mount.textContent).not.toMatch(/Host internal|private/);
    await act(async () => namedButton(mount, "Retry").click());
    expect(calls).toBe(2); expect(mount.textContent).toContain("a.pdb");
    expect(mount.querySelector('[role="alert"]')).toBeNull();
    expect(mount.textContent).not.toMatch(/NaN|Invalid|ago/);
    await render(homeStub({})); expect(mount.textContent).toContain("No recent files");
  });
});

test("changing the host clears old rows and ignores late history responses", async () => {
  await homeFixture(async (mount, render) => {
    let finish!: (files: ReturnType<typeof recentFile>[]) => void;
    await render(homeStub({ recent: () => new Promise(resolve => { finish = resolve; }) }));
    expect(mount.querySelector('[aria-busy="true"]')).not.toBeNull();
    await render(homeStub({ recent: async () => [recentFile("current.pdb")] }));
    await act(async () => finish([recentFile("stale.pdb")]));
    expect(mount.textContent).toContain("current.pdb"); expect(mount.textContent).not.toContain("stale.pdb");
    await render(homeStub({ recent: () => new Promise(() => {}) }));
    expect(mount.textContent).not.toContain("current.pdb");
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("Loading recent files…");
  });
});

test("repeated clicks open once; old failures cannot overwrite a new host's pending open", async () => {
  await homeFixture(async (mount, render) => {
    const calls: string[] = []; let reject!: (error: Error) => void; let finish!: () => void;
    await render(homeStub({ recent: async () => [recentFile("old.pdb")], open: link => { calls.push(link); return new Promise((_resolve, fail) => { reject = fail; }); } }));
    const old = mount.querySelector<HTMLButtonElement>('[aria-label="Open old.pdb"]')!;
    await act(async () => { old.click(); old.click(); });
    expect(calls).toEqual(["/open?path=%2Fsamples%2Fold.pdb"]);
    expect(old.disabled).toBe(true);
    await render(homeStub({ recent: async () => [recentFile("new.pdb")], open: () => new Promise(resolve => { finish = resolve; }) }));
    const current = mount.querySelector<HTMLButtonElement>('[aria-label="Open new.pdb"]')!;
    await act(async () => current.click());
    await act(async () => reject(new Error("Old failure")));
    expect(mount.querySelector('[role="alert"]')).toBeNull(); expect(current.disabled).toBe(true);
    await act(async () => finish()); expect(current.disabled).toBe(false);
  });
});
