import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["HTMLFormElement", "DocumentFragment"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
for (const key of ["window", "document", "navigator", "HTMLElement", "SVGElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { DatabaseQueryDialog } = await import("../apps/desktop/src/components/database-query-dialog");
const { databaseQueryDraft } = await import("../apps/desktop/src/hooks/use-app-database");
type Draft = NonNullable<React.ComponentProps<typeof DatabaseQueryDialog>["query"]>;
async function fixture(run: (mount: HTMLDivElement, calls: unknown[], render: (query: Draft | null, onSubmit?: (draft: Draft) => Promise<void>) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount); const calls: unknown[] = [];
  const render = (query: Draft | null, onSubmit?: (draft: Draft) => Promise<void>) => act(async () => root.render(<DatabaseQueryDialog query={query}
    onDismiss={() => calls.push("close")} onSubmit={draft => { calls.push(draft); return onSubmit?.(draft); }} />));
  try { await run(mount, calls, render); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const button = (mount: Element, name: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === name)!;
const submit = (mount: Element) => act(async () => mount.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
async function fill(mount: Element, name: string, value: string) {
  await act(async () => {
    const el = mount.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)!;
    const prototype = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

test("structure searches enforce required input, reveal similarity and preserve the exact draft", async () => {
  await fixture(async (mount, calls, render) => {
    const initial = databaseQueryDraft("chembl"); await render(initial);
    await submit(mount); expect(calls).toEqual([]);
    await fill(mount, "structure", " CCO "); await fill(mount, "mode", "similarity");
    expect(mount.textContent).toContain("Minimum similarity (%)");
    await submit(mount);
    expect(calls).toEqual([{ ...initial, structure: " CCO ", searchMode: "similarity" }]);
    await fill(mount, "mode", "exact"); expect(mount.textContent).not.toContain("Minimum similarity (%)");
  });
});

test("SQL switches its connection fields, keeps read-only and keychain notices, and resets secrets on provider change", async () => {
  await fixture(async (mount, calls, render) => {
    const initial = databaseQueryDraft("sql"); await render(initial);
    expect(button(mount, "Search").disabled).toBe(true);
    expect(mount.querySelector('input[name="password"]')?.getAttribute("type")).toBe("password");
    expect(mount.textContent).toMatch(/login keychain.*read-only/s);
    await fill(mount, "connection", "postgres://user@example.test/database"); await fill(mount, "password", "test-only-secret");
    await fill(mount, "statement", "SELECT smiles FROM compounds"); await submit(mount);
    expect(calls).toEqual([{ ...initial, sqlConnection: "postgres://user@example.test/database", sqlPassword: "test-only-secret", sqlStatement: "SELECT smiles FROM compounds" }]);
    await fill(mount, "engine", "sqlite"); expect(mount.querySelector('input[name="password"]')).toBeNull();
    expect(mount.textContent).toContain("Database file");
    await render(databaseQueryDraft("chemspace"));
    expect(mount.querySelector<HTMLInputElement>('input[name="api-key"]')?.value).toBe("");
    expect(mount.textContent).not.toContain("test-only-secret");
    expect(localStorage.length).toBe(0);
  });
});

test("catalogue, URL and text sources expose their own inputs without leaking previous values", async () => {
  await fixture(async (mount, calls, render) => {
    await render(databaseQueryDraft("building-blocks"));
    await fill(mount, "structure", "CCO"); await fill(mount, "catalogue-providers", "Enamine,Mcule");
    await fill(mount, "min-amount", "0.5"); await fill(mount, "max-price", "25"); await submit(mount);
    expect(calls).toEqual([{ ...databaseQueryDraft("building-blocks"), structure: "CCO", catalogueProviders: "Enamine,Mcule", minAmount: "0.5", maxPrice: "25" }]);
    await render(databaseQueryDraft("url")); expect(button(mount, "Search").disabled).toBe(true);
    expect(mount.textContent).toContain("local network are refused");
    await fill(mount, "url", "https://example.org/compounds.sdf.gz"); expect(button(mount, "Search").disabled).toBe(false);
    await render(databaseQueryDraft("cod")); await fill(mount, "text", "C9 H8 O4"); await fill(mount, "field", "formula"); await submit(mount);
    expect(calls[1]).toEqual({ ...databaseQueryDraft("cod"), text: "C9 H8 O4", field: "formula" });
    await render(databaseQueryDraft("chembl-actives")); expect(mount.textContent).toContain("Matches are added to the open collection.");
    expect(mount.querySelector('select[name="mode"]')).toBeNull();
  });
});

test("pending submissions cannot repeat or dismiss; late errors cannot overwrite a new source", async () => {
  await fixture(async (mount, calls, render) => {
    let reject!: (error: Error) => void;
    const initial = databaseQueryDraft("patents", { text: "aspirin" });
    await render(initial, () => new Promise((_resolve, fail) => { reject = fail; }));
    await submit(mount); await submit(mount);
    expect(calls).toEqual([initial]);
    expect([button(mount, "Search").disabled, button(mount, "Cancel").disabled, mount.querySelector('[role="status"]')?.textContent]).toEqual([true, true, "Starting…"]);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(calls).toHaveLength(1);
    await render(databaseQueryDraft("wikipedia"));
    await act(async () => reject(new Error("internal secret /private/path")));
    expect(mount.querySelector('[role="alert"]')).toBeNull();
    expect(button(mount, "Search").disabled).toBe(false);
    await render(initial, async () => { throw new Error("private credentials"); }); await submit(mount);
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not start this search. Try again.");
    expect(mount.textContent).not.toContain("private credentials");
  });
});
