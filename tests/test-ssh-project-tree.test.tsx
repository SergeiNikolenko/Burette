import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { RemoteProject } = await import("../apps/desktop/src/components/ssh/ssh-project-tree");

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
    await act(async () => { root.render(<RemoteProject project={{ id: "test", name: "Remote", host: "fixture", root: "/data" }} onOpen={() => {}} />); });
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
