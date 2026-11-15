import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(browser, { __TAURI_INTERNALS__: {} });

let pending: string[] = [];
let notify!: () => void;
let register: (() => Promise<() => void>) | undefined;
const invoke = mock(async () => pending.splice(0));
const unlisten = mock(() => {});
const tauriCore = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen: async (_event: string, callback: () => void) => {
    notify = callback;
    return register ? register() : unlisten;
  },
}));
const { createRoot } = await import("react-dom/client");
const { useOpenEvents } = await import("../apps/desktop/src/hooks/use-open-events");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");

async function fixture(open: (paths: string[]) => void | Promise<void>) {
  let settled = false;
  const errors = mock(() => {});
  function Harness() { settled = useOpenEvents(open, errors); return null; }
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<Harness />));
  return {
    errors,
    settled: () => settled,
    close: async () => { await act(async () => root.unmount()); node.remove(); },
  };
}

test("startup and subsequent Finder opens retain restored tabs and pinning", async () => {
  useMoleculeStore.getState().setDocuments([]);
  useMoleculeStore.getState().openScreenTab({ kind: "jobs" });
  useMoleculeStore.getState().togglePinnedTab(useMoleculeStore.getState().activeTabId!);
  const restored = useMoleculeStore.getState().tabs;
  pending = ["/first.pdb"];
  const open = mock((paths: string[], options?: { replace?: boolean }) => {
    const documents = paths.map(path => ({ id: path, path, title: path, extension: "pdb", renderer: "molstar" as const, runtimePath: "", byteCount: 1 }));
    if (options?.replace) useMoleculeStore.getState().setDocuments(documents);
    else useMoleculeStore.getState().addDocuments(documents);
  });
  const hook = await fixture(open);
  try {
    expect(hook.settled()).toBe(true);
    expect(useMoleculeStore.getState().tabs).toEqual(expect.arrayContaining(restored.filter(tab => tab.location.kind !== "launcher")));
    pending = ["/second.pdb"];
    await act(async () => notify());
    expect(useMoleculeStore.getState().documents.map(document => document.path)).toEqual(["/first.pdb", "/second.pdb"]);
    expect(useMoleculeStore.getState().tabs).toEqual(expect.arrayContaining(restored.filter(tab => tab.location.kind !== "launcher")));
  } finally { await hook.close(); }
});

test("startup remains pending until asynchronous opening succeeds", async () => {
  pending = ["/large.pdb"];
  let finish!: () => void;
  const opening = new Promise<void>(resolve => { finish = resolve; });
  const hook = await fixture(() => opening);
  try {
    expect(hook.settled()).toBe(false);
    await act(async () => finish());
    expect(hook.settled()).toBe(true);
    expect(hook.errors).not.toHaveBeenCalled();
  } finally { await hook.close(); }
});

test("startup remains pending until asynchronous opening finishes and reports its rejection", async () => {
  pending = ["/broken.pdb"];
  let reject!: (error: Error) => void;
  const opening = new Promise<void>((_resolve, fail) => { reject = fail; });
  const hook = await fixture(() => opening);
  try {
    expect(hook.settled()).toBe(false);
    const error = new Error("Cannot read document");
    await act(async () => reject(error));
    expect(hook.settled()).toBe(true);
    expect(hook.errors).toHaveBeenCalledWith(error, "Startup open failed");
  } finally { await hook.close(); }
});

test("a disposed listener registration does not consume pending startup files", async () => {
  let finish!: (value: () => void) => void;
  register = () => new Promise(resolve => { finish = resolve; });
  pending = ["/still-pending.pdb"];
  const open = mock(() => {});
  const hook = await fixture(open);
  try {
    await hook.close();
    await act(async () => finish(unlisten));
    expect(open).not.toHaveBeenCalled();
    expect(pending).toEqual(["/still-pending.pdb"]);
    expect(unlisten).toHaveBeenCalled();
  } finally { register = undefined; }
});
