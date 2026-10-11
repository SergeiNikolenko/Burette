import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
Object.defineProperty(globalThis, "DocumentFragment", { configurable: true, value: browser.DocumentFragment });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { FolderOpenDialog } = await import("../apps/desktop/src/components/folder-open-dialog");
type Props = React.ComponentProps<typeof FolderOpenDialog>;
const proteinFiles = ["/set/a.pdb", "/set/b.cif", "/set/sub/c.pdb"];

async function fixture(files: string[], run: (mount: HTMLDivElement, calls: unknown[][], props: Props) => Promise<void>, patch: Partial<Props> = {}) {
  const calls: unknown[][] = [];
  const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); };
  const props = {
    path: "/set", initialMode: "tabs", onClose: () => { calls.push(["close"]); },
    state: { sidebarProjects: [{ items: files.map(path => ({ path })) }] } as Props["state"],
    actions: { openPaths: record("tabs"), openNewWindow: record("window"), openDockPayload: record("right"), openDockingDocument: record("together") } as Props["actions"],
    workflows: { sceneTargets: () => [{ id: "target", title: "Complex" }], addToScene: record("scene"), openAligned: record("aligned"), openPoses: record("poses") } as unknown as Props["workflows"],
    ...patch,
  };
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount); const root = createRoot(mount);
  try { await act(async () => root.render(<FolderOpenDialog {...props} />)); await run(mount, calls, props); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const checkbox = (mount: Element, text: string) => Array.from(mount.querySelectorAll("label")).find(el => el.textContent?.trim() === text)!.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
const submit = async (mount: Element) => act(async () => mount.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

test("folder selection supports mixed select-all, recursive discovery and exact tab payload", async () => {
  await fixture(proteinFiles, async (mount, calls) => {
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("2 of 2 selected");
    await act(async () => checkbox(mount, "a.pdb").click());
    expect(checkbox(mount, "Select all").getAttribute("aria-checked")).toBe("mixed");
    await act(async () => checkbox(mount, "Select all").click());
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("2 of 2 selected");
    await act(async () => checkbox(mount, "Select all").click());
    await submit(mount); expect(calls).toEqual([]);
    await act(async () => checkbox(mount, "Include subfolders").click());
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("3 of 3 selected");
    await submit(mount); expect(calls).toEqual([["tabs", proteinFiles], ["close"]]);
  });
});

test("folder modes preserve scene, alignment, poses and right-panel dispatch", async () => {
  const proteins = proteinFiles.slice(0, 2), molecules = ["/set/a.sdf", "/set/b.sdf"];
  for (const mode of ["together", "aligned", "poses", "right", "scene:target"]) {
    const files = mode === "poses" ? molecules : proteins;
    await fixture(files, async (mount, calls) => {
      await submit(mount);
      const expected = mode === "together" ? ["together", files[0], [files[1]], { sceneMode: "structureAll" }]
        : mode === "scene:target" ? ["scene", files, { id: "target", title: "Complex" }]
        : mode === "right" ? ["right", { area: "right", tabKind: "files", payload: { paths: files, records: [], items: files.map(path => ({ kind: "file", path, title: path.split("/").pop() })) } }]
        : [mode, files];
      expect(calls).toEqual([expected, ["close"]]);
    }, { initialMode: mode });
  }
});

test("invalid combinations and more than 200 files cannot be submitted", async () => {
  await fixture(["/set/a.sdf"], async (mount, calls) => { await submit(mount); expect(calls).toEqual([]); }, { initialMode: "aligned" });
  await fixture(Array.from({ length: 201 }, (_, i) => `/set/${i}.pdb`), async (mount, calls) => {
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("0 of 201 selected");
    await act(async () => { for (const cb of mount.querySelectorAll<HTMLButtonElement>('[aria-label="Files to open"] [role="checkbox"]')) cb.click(); });
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Select at most 200 files.");
    await submit(mount); expect(calls).toEqual([]);
  });
});

test("in-flight open is guarded and failure stays retryable without raw error text", async () => {
  let reject!: (error: Error) => void; let opened = 0; const oldError = console.error; console.error = () => {};
  try {
    await fixture(proteinFiles, async (mount, calls, props) => {
      props.actions.openPaths = () => { opened++; return new Promise<void>((_resolve, fail) => { reject = fail; }); };
      await submit(mount); await submit(mount); expect(opened).toBe(1);
      expect(Array.from(mount.querySelectorAll<HTMLButtonElement>("button")).every(button => button.disabled)).toBe(true);
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(calls).toEqual([]);
      await act(async () => reject(new Error("secret path /private/data")));
      expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not open the selected files. Try again.");
      expect(mount.textContent).not.toContain("/private/data");
      expect(mount.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    });
  } finally { console.error = oldError; }
});
