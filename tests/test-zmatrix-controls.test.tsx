import { afterAll, expect, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window, type HTMLElement as BrowserElement, type HTMLInputElement as BrowserInput, type HTMLButtonElement as BrowserButton } from "happy-dom";
import React, { act } from "react";
import { parseZmatrixDocument } from "../scripts/zmatrix-document.mjs";
import { addZmatrixVariable, bindZmatrixCoordinate, renameZmatrixVariable, removeZmatrixVariable } from "../scripts/zmatrix-editing.mjs";
import { editZmatrixRows } from "../scripts/zmatrix-rows.mjs";
import { withReference, zmatrixRowLabels } from "../apps/desktop/src/lib/workbench/zmatrix-draft";

plugin({ name: "zmatrix-controls-react-compiler", setup(build) {
  build.onLoad({ filter: /zmatrix-(definition|row)-controls\.tsx$/u }, ({ path }) => {
    const code = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] })?.code;
    if (!code?.includes("react/compiler-runtime")) throw new Error("Controls were not compiled");
    return { contents: code, loader: "tsx" };
  });
} });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "DocumentFragment", "SVGElement", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? browser : browser[key] });
}
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import("react-dom/client");
const { VariableForm, VariableName, CoordinateDefinition } = await import("../apps/desktop/src/components/workbench/zmatrix-definition-controls");
const { ZmatrixAddMenu, ZmatrixRowMenu } = await import("../apps/desktop/src/components/workbench/zmatrix-row-controls");
const water = "O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 0.9572\nA = 52.26\n";
const body = browser.document.body;
function labelled(label: string) {
  const node = body.querySelector<BrowserElement>(`[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing control: ${label}`);
  return node;
}
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function click(node: BrowserElement) { await act(async () => node.click()); await settle(); }
async function menu(label: string) {
  await act(async () => { labelled(label).focus(); labelled(label).dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
}
async function choose(text: string, role = "menuitem") {
  const item = Array.from(body.querySelectorAll<BrowserElement>(`[role="${role}"]`)).find(node => node.textContent === text);
  if (!item) throw new Error(`Missing menu item: ${text}`);
  await click(item);
}
async function type(label: string, value: string) {
  await act(async () => {
    const input = labelled(label);
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
}
async function submit(label: string) {
  await act(async () => labelled(label).closest("form")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true })));
  await settle();
}
async function fixture(node: React.ReactNode) {
  const host = browser.document.createElement("div"); body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  await act(async () => root.render(node));
  return async () => { await act(async () => root.unmount()); await settle(); host.remove(); };
}
const rejected = (action: () => void) => { try { action(); return null; } catch (error) { return (error as Error).message; } };

test("variable add and rename retain rejected input; menus hand keyboard focus to the real form", async () => {
  let definition = parseZmatrixDocument(water);
  let close = await fixture(<VariableForm suggestedName="V1" onAdd={(name, value) => rejected(() => { definition = addZmatrixVariable(definition, name, value); })} />);
  try {
    await type("Variable name", "R"); await type("Variable value", "2"); await submit("Variable name");
    expect(body.querySelector('[role="alert"]')?.textContent).toContain("unique");
    expect((labelled("Variable value") as BrowserInput).value).toBe("2");
    expect(definition.variables.length).toBe(2);
    await type("Variable name", "New"); await submit("Variable name");
    expect(definition.variables.at(-1)).toEqual({ name: "New", value: 2 });
  } finally { await close(); }
  close = await fixture(<VariableName name="R" disabled={false} onRename={next => rejected(() => { definition = renameZmatrixVariable(definition, "R", next); })}
    onRemove={() => { definition = removeZmatrixVariable(definition, "R"); }} />);
  try {
    await menu("R actions"); await choose("Rename");
    expect(browser.document.activeElement).toBe(labelled("Rename variable R"));
    await type("Rename variable R", "A"); await submit("Rename variable R");
    expect(body.querySelector('[role="alert"]')).not.toBeNull();
    expect((labelled("Rename variable R") as BrowserInput).value).toBe("A");
    await type("Rename variable R", "Bond"); await submit("Rename variable R");
    expect(definition.rows.slice(2).map(row => row.values[0])).toEqual(["Bond", "Bond"]);
    expect(body.querySelector('[aria-label="Rename variable R"]')).toBeNull();
  } finally { await close(); }
  close = await fixture(<VariableName name="Bond" disabled={false} onRename={() => null}
    onRemove={() => { definition = removeZmatrixVariable(definition, "Bond"); }} />);
  try {
    await menu("Bond actions"); await choose("Remove");
    expect(definition.rows.slice(2).map(row => row.values[0])).toEqual([.9572, .9572]);
    expect(definition.variables.map(variable => variable.name)).toEqual(["A", "New"]);
  } finally { await close(); }
});

test("coordinate menus select real references and only valid signed bindings; removal keeps coordinate values", async () => {
  let definition = parseZmatrixDocument(water);
  const references: number[][] = [];
  const close = await fixture(<CoordinateDefinition label="H3 bond" slot={0} refs={definition.rows[3].refs}
    earlierRows={zmatrixRowLabels(definition).slice(0, 3)} token="R" variables={["R", "A"]} disabled={false}
    canBind={binding => rejected(() => { bindZmatrixCoordinate(definition, 3, 0, binding); }) === null}
    onReference={reference => { references.push(withReference(definition.rows[3].refs, 0, reference)); }}
    onBind={binding => { definition = bindZmatrixCoordinate(definition, 3, 0, binding); }} />);
  try {
    await menu("H3 bond definition");
    expect(Array.from(body.querySelectorAll('[role="menuitemradio"]')).map(node => node.textContent)).not.toContain("−R");
    await choose("Ref 1", "menuitemradio"); expect(references).toEqual([[1, 0, 2]]);
    await menu("H3 bond definition"); await choose("Value", "menuitemradio");
    expect(definition.rows[3].values[0]).toBe(.9572);
    definition = removeZmatrixVariable(definition, "R");
    expect(definition.rows[2].values[0]).toBe(.9572);
    expect(definition.variables.map(variable => variable.name)).toEqual(["A"]);
  } finally { await close(); }
});

test("Add atom and reference point use real row validation and preserve the rejected form", async () => {
  let definition = parseZmatrixDocument(water);
  const close = await fixture(<ZmatrixAddMenu disabled={false} rowLabels={zmatrixRowLabels(definition)} variables={["R", "A"]} suggestedName="V1"
    onAddRow={row => rejected(() => { definition = editZmatrixRows(definition, { type: "append", row }).document; })}
    onAddVariable={(name, value) => rejected(() => { definition = addZmatrixVariable(definition, name, value); })} />);
  try {
    await menu("Add"); await choose("Add atom");
    expect(browser.document.activeElement).toBe(labelled("Element"));
    await type("Element", "X"); await submit("Element");
    expect(body.querySelector('[role="alert"]')?.textContent).toContain("reference point");
    expect((labelled("Element") as BrowserInput).value).toBe("X");
    await type("Element", "F"); await submit("Element");
    expect(definition.rows.at(-1)).toEqual({ element: "F", refs: [3, 2, 1], values: [1, 109.47, 180] });
    definition = parseZmatrixDocument(water);
    await menu("Add"); await choose("Add reference point");
    expect(body.querySelector('[aria-label="Element"]')).toBeNull();
    await submit("Bond, Å"); expect(definition.rows.at(-1)?.element).toBe("X");
  } finally { await close(); }
});

test("row menus disable endpoint moves and emit original row indices; a disabled trigger cannot open", async () => {
  const moves: number[] = []; let removed = 0;
  let close = await fixture(<ZmatrixRowMenu label="O1" referencePoint={false} index={0} rowCount={4} disabled={false} onMove={to => moves.push(to)} onRemove={() => removed++} />);
  try {
    await menu("O1 actions");
    expect(Array.from(body.querySelectorAll('[role="menuitem"]')).find(node => node.textContent === "Move up")?.getAttribute("aria-disabled")).toBe("true");
    await choose("Move down"); expect(moves).toEqual([1]);
    await menu("O1 actions"); await choose("Remove O1"); expect(removed).toBe(1);
  } finally { await close(); }
  close = await fixture(<ZmatrixRowMenu label="Ref 1" referencePoint index={1} rowCount={4} disabled onMove={() => moves.push(99)} onRemove={() => removed++} />);
  try { expect((labelled("Ref 1 actions") as BrowserButton).disabled).toBe(true); await click(labelled("Ref 1 actions")); expect(body.querySelector('[role="menu"]') === null).toBe(true); }
  finally { await close(); }
});
