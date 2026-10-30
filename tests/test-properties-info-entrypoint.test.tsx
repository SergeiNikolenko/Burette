import { expect, test } from "bun:test";
import React, { act } from "react";
import { mount, documentFor, logical, until, button, click, defaultPreferences, files } from "./properties-runtime-fixture";
import { readFileSync } from "node:fs";
const { StructureInfoPanel } = await import("../apps/desktop/src/components/structure-info-panel");
const { DEFAULT_CONFORMER_SETTINGS, DEFAULT_XTB_SETTINGS } = await import("../apps/desktop/src/lib/chemistry-settings");
const nativeFetch = fetch;
Object.defineProperty(globalThis, "fetch", { configurable: true, value: Object.assign(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/__burette/folding-result") return Response.json({ models: [], artifacts: [] });
  throw new Error(`Unexpected Info transport ${url.pathname}`);
}, { preconnect: nativeFetch.preconnect }) });
const content: NonNullable<Parameters<typeof mount>[1]> = (document, actions) => <StructureInfoPanel document={document} gridFilterModel={null} dockDrops={[]}
  conformerStatus={null} conformerSettings={DEFAULT_CONFORMER_SETTINGS} viewerLigandSelection={null} structureOverlayMode="single"
  xtbStatus={null} xtbSettings={DEFAULT_XTB_SETTINGS} xtbJobs={[]} preferences={defaultPreferences} isBrowserDev actions={actions} />;

test("actual Info Tools opens Properties and hands one SDF edit to the Edit tab", async () => {
  const doc = documentFor("sdf"); files.set(doc.path, readFileSync(new URL("./fixtures/properties/ethanol.sdf", import.meta.url), "utf8")); const f = await mount(doc, content);
  try {
    await click(button("Calculate properties")); await until(() => document.querySelector('[role="dialog"] dt') && !button("Add hydrogens").disabled);
    expect([...document.querySelectorAll('[role="dialog"] dt')].map(node => node.textContent)).toContain("Molecular weight");
    await click(button("Add hydrogens")); await until(() => f.dock.length === 1);
    expect(f.dock).toEqual(["structure-edit"]); expect(f.controller().sessionForDocument(doc)?.dirty).toBe(true);
    await until(() => !document.querySelector('[role="dialog"]'));
  } finally { await f.close(); }
});

test("Info dialog closes on exact document replacement and keyboard Escape; unsupported input has no trigger", async () => {
  const doc = documentFor("molx"); logical(doc); const f = await mount(doc, content);
  try {
    const trigger = button("Calculate properties"); trigger.focus(); await click(trigger); await until(() => document.querySelector('[role="dialog"] dt'));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await until(() => !document.querySelector('[role="dialog"]'));
    await until(() => document.activeElement === trigger); expect(document.activeElement === trigger).toBe(true);
    await click(trigger); const next = { ...doc }; await f.render(next); await until(() => !document.querySelector('[role="dialog"]'));
    await f.render(doc); expect(document.querySelector('[role="dialog"]') === null).toBe(true);
    await click(button("Calculate properties")); await until(() => document.querySelector('[role="dialog"] dt'));
    await f.render(documentFor("pdb"));
    expect(document.querySelector('[aria-label="Calculate properties"]') === null).toBe(true); await until(() => !document.querySelector('[role="dialog"]'));
  } finally { await f.close(); Object.defineProperty(globalThis, "fetch", { configurable: true, value: nativeFetch }); }
});
