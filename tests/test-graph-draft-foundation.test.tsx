import { expect, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { graphDraftText, graphSourceMetadata } from "../apps/desktop/src/lib/workbench/graph-draft";
import { forgetViewerAtomSelection, rememberViewerAtomSelection, useViewerAtomSelection } from "../apps/desktop/src/lib/workbench/selection";
import { measurementPreviewTarget, measurementPreviewTransfer, prepareMeasurementSourcePair, publishMeasurementSourcePair, rememberMeasurementSourcePair } from "../apps/desktop/src/lib/workbench/measurement-preview";

const browser = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Event"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });

test("graph drafts retain uploaded title, foreign SDF items and stable metadata; bare MOL cannot acquire SDF metadata", () => {
  const mol = ["Worker title", "Burette", "", "  0  0  0     0  0            999 V3000", "M  V30 BEGIN CTAB", "M  V30 COUNTS 1 0 0 0 0",
    "M  V30 BEGIN ATOM", "M  V30 1 C 0 0 0 0", "M  V30 END ATOM", "M  V30 END CTAB", "M  END", ""].join("\n");
  const uploaded = `${mol.replace("Worker title", "Uploaded title")}\n> <Vendor>\nKeep this exact value\n\n$$$$\n`;
  const metadata = graphSourceMetadata(uploaded, "sdf", 1)!;
  const draft = graphDraftText(uploaded, "sdf", mol, metadata);
  expect({ title: draft.split("\n")[0], vendor: draft.includes("> <Vendor>\nKeep this exact value\n\n"), metadata: graphSourceMetadata(draft, "sdf", 1), end: draft.endsWith("$$$$\n") })
    .toEqual({ title: "Uploaded title", vendor: true, metadata, end: true });
  expect(graphDraftText("Uploaded title\n", "mol", mol)).toBe(mol.replace("Worker title", "Uploaded title"));
  expect(() => graphDraftText(uploaded, "mol", mol, metadata)).toThrow("MOL files cannot carry SDF metadata");
  expect(() => graphSourceMetadata(draft, "mol", 1)).toThrow("MOL files cannot carry SDF metadata");
});

test("source-index selection is document-scoped, bounded to 96 identities, and never publishes an invalid count", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let selected: ReturnType<typeof useViewerAtomSelection> = null;
  const current = (): ReturnType<typeof useViewerAtomSelection> => selected;
  function Probe() { selected = useViewerAtomSelection("selected"); return null; }
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => rememberViewerAtomSelection("selected", { atoms: 8, atomIdentities: [{ sourceIndex: 2 }, { sourceIndex: 0 }, { sourceIndex: 2 }, { atomIndex: 5 }] }));
    expect(current()).toEqual({ atoms: [0, 2, 5], count: 8, truncated: true });
    const previous = current();
    await act(async () => rememberViewerAtomSelection("other", { atoms: 1, atomIdentities: [{ sourceIndex: 9 }] })); expect(current()).toBe(previous);
    const identities = Array.from({ length: 512 }, (_, sourceIndex) => ({ sourceIndex }));
    await act(async () => rememberViewerAtomSelection("selected", { atoms: Infinity, atomIdentities: identities }));
    expect({ length: current()?.atoms.length, count: current()?.count }).toEqual({ length: 96, count: 96 });
    expect(current()).toEqual({ atoms: Array.from({ length: 96 }, (_, index) => index), count: 96, truncated: true });
    Object.defineProperty(identities, 96, { get() { throw new Error("The unbounded tail must never be inspected."); } });
    await act(async () => rememberViewerAtomSelection("selected", { atoms: 20000, atomIdentities: identities }));
    expect(current()).toEqual({ atoms: Array.from({ length: 96 }, (_, index) => index), count: 20000, truncated: true });
    for (const atoms of [-1, NaN, 2.5, Number.MAX_VALUE]) {
      await act(async () => rememberViewerAtomSelection("selected", { atoms, atomIdentities: [{ sourceIndex: 7 }] }));
      expect(current()).toEqual({ atoms: [7], count: 1, truncated: false });
    }
    await act(async () => forgetViewerAtomSelection("selected")); expect(current()).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); forgetViewerAtomSelection("other"); }
});

test("pair preparation is inert; verified publication keeps format/size identity and bounded Undo/Redo families", async () => {
  const id = "foundation-pairs", pair = await prepareMeasurementSourcePair("initial", "next", 3);
  expect(await measurementPreviewTarget(id, "next")).toBeNull(); publishMeasurementSourcePair(id, pair);
  await rememberMeasurementSourcePair(id, "next", "after", 3);
  const target = (await measurementPreviewTarget(id, "after"))!;
  expect(measurementPreviewTransfer(id, target, { sourceFormat: "sdf", sourceSha256: pair.from, atomCount: 3, items: [] }).targetSourceSha256).toBe(target);
  for (const patch of [{ sourceFormat: "mol" }, { atomCount: 4 }, { sourceSha256: "foreign" }, { items: Array(33).fill({}) }]) {
    expect(() => measurementPreviewTransfer(id, target, { sourceFormat: "sdf", sourceSha256: pair.from, atomCount: 3, items: [], ...patch })).toThrow();
  }
  for (let index = 0; index < 101; index++) publishMeasurementSourcePair(id, await prepareMeasurementSourcePair(`edge-${index}`, `edge-${index + 1}`, 3));
  expect(await measurementPreviewTarget(id, "initial")).toBeNull(); expect(await measurementPreviewTarget(id, "edge-101")).not.toBeNull();
  for (let index = 0; index < 16; index++) publishMeasurementSourcePair(`foundation-document-${index}`, pair);
  expect(await measurementPreviewTarget(id, "edge-101")).toBeNull(); expect(await measurementPreviewTarget("foundation-document-15", "next")).toBe(pair.to);
});
