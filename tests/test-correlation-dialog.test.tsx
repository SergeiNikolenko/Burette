import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["CSS", "MessageEvent", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { CorrelationMatrixDialog } = await import("../apps/desktop/src/components/correlation-matrix-dialog");
type Request = NonNullable<React.ComponentProps<typeof CorrelationMatrixDialog>["request"]>;
const request: Request = { documentId: "matrix", documentTitle: "Series", columns: [
  { id: "mass", label: "Mass", type: "number", kind: "property" },
  { id: "inverse", label: "Inverse", type: "number", kind: "property" },
] };
type Message = { source: string; body: { type: string; requestId: string; documentId: string; columnId: string } };
async function fixture(run: (mount: HTMLDivElement, messages: Message[], render: (request: Request | null) => Promise<void>) => Promise<void>) {
  const iframe = document.createElement("iframe"); iframe.className = "viewer-iframe";
  iframe.dataset.documentId = "matrix"; iframe.dataset.renderer = "grid2d"; document.body.append(iframe);
  const messages: Message[] = [];
  iframe.contentWindow!.postMessage = (value: Message) => { messages.push(value); };
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount);
  const render = (request: Request | null) => act(async () => root.render(<CorrelationMatrixDialog request={request} onDismiss={() => {}} />));
  try { await render(request); await run(mount, messages, render); }
  finally { await act(async () => root.unmount()); mount.remove(); iframe.remove(); }
}
const reply = (requestId: string, values: number[][]) => act(async () => {
  window.dispatchEvent(new MessageEvent("message", { data: { source: "burette-grid", body: { type: "chemicalSpaceColumnValues", requestId, values } } }));
});

test("matrix reads the grid channel and renders positive and negative coefficients with row counts", async () => {
  await fixture(async (mount, messages, render) => {
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("Reading columns…");
    expect(messages[0]).toEqual({ source: "burette-grid-host", body: { type: "chemicalSpaceRequestColumnValues", requestId: messages[0].body.requestId, documentId: "matrix", columnId: "mass" } });
    await reply("unrelated", []); expect(messages).toHaveLength(1);
    await reply(messages[0].body.requestId, [[0, 1], [1, 2], [2, 3]]);
    expect(messages[1].body.columnId).toBe("inverse");
    await reply(messages[1].body.requestId, [[0, 3], [1, 2], [2, 1]]);
    expect(Array.from(mount.querySelectorAll("td")).map(el => [el.textContent, el.title])).toEqual([
      ["1.00", "Mass vs Mass: r = 1.000 over 3 rows"], ["-1.00", "Mass vs Inverse: r = -1.000 over 3 rows"],
      ["-1.00", "Inverse vs Mass: r = -1.000 over 3 rows"], ["1.00", "Inverse vs Inverse: r = 1.000 over 3 rows"],
    ]);
    await render({ ...request, columns: request.columns.slice(0, 1) });
    expect(mount.querySelector("table")).toBeNull();
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("This collection has fewer than two numeric columns to correlate.");
  });
});

test("new requests clear stale matrices and unavailable collections show a recoverable message", async () => {
  const oldError = console.error; console.error = () => {};
  try {
    await fixture(async (mount, messages, render) => {
      await reply(messages[0].body.requestId, [[0, 1], [1, 2], [2, 3]]);
      await reply(messages[1].body.requestId, [[0, 1], [1, 1], [2, 1]]);
      expect(Array.from(mount.querySelectorAll("td")).map(el => el.textContent)).toEqual(["1.00", "", "", "1.00"]);
      await render({ ...request });
      expect(mount.querySelector("table")).toBeNull();
      await render({ ...request, documentId: "missing" });
      expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not read this collection. Reopen the matrix to try again.");
      await reply(messages[2].body.requestId, [[0, 1], [1, 2], [2, 3]]);
      expect(mount.querySelector("table")).toBeNull();
      expect(messages).toHaveLength(3);
    });
  } finally { console.error = oldError; }
});
