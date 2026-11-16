import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { XYZ, waterScience } from "./scientific-data-fixture";
import { addDocumentInternalCoordinates, adoptRestoredScientificSource, claimImportedSource, forgetImportedSource, importedOriginalFor,
  newImportToken, recordImportedRevision, registerImportedScientificSource, releaseClosedImports, releaseScopedScientificSource,
  registeredRevision, scientificStateFor, useImportedOriginal, useImportedRevisions } from "../apps/desktop/src/lib/workbench/scientific-source-state";
const browser = new Window(), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(() => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import("react-dom/client");

test("a shared import keeps its exact original while any claimed document remains open", () => {
  const token = newImportToken(), text = XYZ.replace("water restored", token), data = waterScience(), file = new Blob(["exact uploaded bytes"]);
  registerImportedScientificSource(token, text, data, { name: "water.out", file });
  try {
    claimImportedSource(token, "a"); claimImportedSource(token, "b");
    expect(scientificStateFor("a", text).revision!.document).toBe(data);
    expect(importedOriginalFor("b")!.file).toBe(file);
    expect(scientificStateFor("a", text + "changed").revision).toBeNull();
    releaseClosedImports(new Set(["b"])); expect(importedOriginalFor("b")!.file).toBe(file);
    releaseClosedImports(new Set()); expect(importedOriginalFor("b")).toBeNull();
  } finally { forgetImportedSource(token); }
});

test("restored documents with identical source text keep independent revisions and Originals", () => {
  const first = waterScience(), second = waterScience(), a = new Blob(["a"]), b = new Blob(["b"]);
  adoptRestoredScientificSource("restored-a", { text: XYZ, document: first }, { name: "same.out", file: a });
  adoptRestoredScientificSource("restored-b", { text: XYZ, document: second }, { name: "same.out", file: b });
  try {
    expect(scientificStateFor("restored-a", XYZ).revision!.document).toBe(first);
    expect(scientificStateFor("restored-b", XYZ).revision!.document).toBe(second);
    expect(importedOriginalFor("restored-a")!.file).toBe(a);
    releaseScopedScientificSource("restored-a");
    expect(importedOriginalFor("restored-a")).toBeNull(); expect(importedOriginalFor("restored-b")!.file).toBe(b);
  } finally { releaseScopedScientificSource("restored-a"); releaseScopedScientificSource("restored-b"); }
});

test("subscribed history and Original snapshots retain rollback ownership and do not overwrite newer revisions", async () => {
  const id = "history", file = new Blob(["original"]), data = waterScience(), one = XYZ + "\n", two = XYZ + "\n\n";
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host as unknown as Element);
  let snapshot: ReturnType<typeof useImportedRevisions> = null, original: ReturnType<typeof useImportedOriginal> = null;
  function Probe() { snapshot = useImportedRevisions(id, XYZ); original = useImportedOriginal(id); return <span>{snapshot?.length ?? 0}</span>; }
  try {
    await act(async () => root.render(<Probe />)); expect(snapshot).toBeNull();
    await act(async () => { adoptRestoredScientificSource(id, { text: XYZ, document: data }, { name: "water.out", file }); });
    expect(host.textContent).toBe("1"); expect(original!.file).toBe(file);
    await act(async () => addDocumentInternalCoordinates(id, XYZ, data));
    const initial = snapshot; let rollbackOne: (() => void) | null = null, rollbackTwo: (() => void) | null = null;
    await act(async () => { rollbackOne = recordImportedRevision(id, XYZ, { text: one, document: data }); });
    expect(snapshot!.length).toBe(2);
    await act(async () => { rollbackTwo = recordImportedRevision(id, one, { text: two, document: data }); rollbackOne!(); });
    expect(snapshot!.length).toBe(3);
    await act(async () => { rollbackTwo!(); rollbackOne!(); });
    expect(snapshot).toBe(initial); expect(original!.file).toBe(file);
    await act(async () => releaseScopedScientificSource(id));
    expect(snapshot).toBeNull(); expect(original).toBeNull();
  } finally { await act(async () => root.unmount()); releaseScopedScientificSource(id); host.remove(); }
});


test("repeated exact text selects the latest scientific revision consistently and rollback restores it", () => {
  const id = "repeated-science", first = waterScience(), middle = waterScience(), latest = waterScience(), text = XYZ + "\n";
  middle.frames[0].energyHartree = -75;
  latest.modes = []; latest.frames[0].modes = []; latest.orbitals = [];
  adoptRestoredScientificSource(id, { text: XYZ, document: first }, null);
  try {
    const rollbackMiddle = recordImportedRevision(id, XYZ, { text, document: middle })!;
    const rollbackLatest = recordImportedRevision(id, text, { text: XYZ, document: latest })!;
    expect(scientificStateFor(id, XYZ).position).toBe(2);
    expect(registeredRevision(id, XYZ)!.revision === scientificStateFor(id, XYZ).revision).toBe(true);
    expect(registeredRevision(id, XYZ)!.revision.document).toBe(latest);
    rollbackLatest();
    expect(registeredRevision(id, text)!.revision === scientificStateFor(id, text).revision).toBe(true);
    expect(registeredRevision(id, text)!.revision.document).toBe(middle);
    expect(registeredRevision(id, XYZ)!.revision.document).toBe(first);
    rollbackMiddle();
    expect(scientificStateFor(id, XYZ).position).toBe(0);
    expect(registeredRevision(id, XYZ)!.revision === scientificStateFor(id, XYZ).revision).toBe(true);
    expect(registeredRevision(id, text)).toBeNull();
  } finally { releaseScopedScientificSource(id); }
});
