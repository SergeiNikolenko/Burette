import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, createRef } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Button } = await import("../apps/desktop/src/components/ui/button");

test("Atlas button retains accessible content, ref, clicks and native disabled semantics", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLButtonElement>();
  const calls: string[] = [];
  try {
    await act(async () => root.render(<form>
      <Button ref={ref} onClick={() => calls.push("run")}><svg aria-hidden /><span>Run</span></Button>
      <Button disabled onClick={() => calls.push("disabled")}>Unavailable</Button>
      <Button type="submit">Save</Button>
    </form>));
    const buttons = [...container.querySelectorAll("button")];
    expect(ref.current).toBe(buttons[0]);
    expect(buttons.map(el => [el.textContent, el.type, el.disabled])).toEqual([
      ["Run", "button", false], ["Unavailable", "button", true], ["Save", "submit", false],
    ]);
    await act(async () => { buttons[0].click(); buttons[1].click(); });
    expect(calls).toEqual(["run"]);
    expect(buttons[1].getAttribute("aria-disabled")).toBe("true");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("slotted download remains a single link with its attributes, ref and both handlers", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLAnchorElement>();
  const calls: string[] = [];
  try {
    await act(async () => root.render(
      <Button asChild variant="ghost" size="icon" aria-label="Download structure" onClick={() => calls.push("button")}>
        <a ref={ref} href="/structure.sdf" download="structure.sdf" onClick={event => { event.preventDefault(); calls.push("link"); }}><svg aria-hidden /></a>
      </Button>,
    ));
    const link = container.querySelector("a")!;
    expect(ref.current).toBe(link);
    expect(container.querySelector("button")).toBeNull();
    expect([link.getAttribute("href"), link.getAttribute("download"), link.getAttribute("aria-label")])
      .toEqual(["/structure.sdf", "structure.sdf", "Download structure"]);
    expect(link.querySelectorAll("svg").length).toBe(1);
    await act(async () => link.click());
    expect(calls).toEqual(["link", "button"]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
