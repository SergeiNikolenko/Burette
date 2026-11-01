import { readFileSync } from "node:fs";
import { act, expect, test, browser, pickerFixture, settle, readBrowserScientificAttachment, readBrowserSourceCheckpoint, documents, useMoleculeStore, scientificStateFor } from "./mcd-picker-fixture";
const oneBlock = () => new File(["10000 -2.25 .12\r\n12000 1.5 .25\r\n"], "explicit.mcd");

test("ordinary scientific import without built-in spectra exposes Add MCD through Compute and restores it after close/reopen", async () => {
 const f = await pickerFixture("mcd-route.fchk", "route");
 try {
  await f.openSpectra(); expect(f.dockDocuments).toEqual([f.doc.id]);
  expect(f.host.querySelectorAll("table")).toHaveLength(0); expect(f.host.textContent).toContain("Add MCD…");
  await f.choose(oneBlock()); await settle(() => Boolean(f.host.querySelector('table[aria-label="MCD source values"]')));
  const saved = (await readBrowserScientificAttachment(f.doc.path))!;
  expect(saved.text).toBe(f.text); expect(await saved.companions[0].file.text()).toBe(await oneBlock().text());
  expect(await readBrowserSourceCheckpoint(f.doc.path)).toBeNull(); expect(f.source.sessionForDocument(f.doc)).toBeNull();
  Object.assign(browser, { setImmediate: globalThis.setImmediate, clearImmediate: globalThis.clearImmediate });
  const { PluginContext } = await import("molstar/lib/mol-plugin/context.js"), { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
  const { science: native } = await import("./science-session-fixture"), { prepareSceneScienceExport } = await import("../apps/desktop/src/lib/science-session/export"), { decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
  const plugin = new PluginContext(DefaultPluginSpec());
  try {
    await plugin.init(); const raw = await plugin.builders.data.rawData({ data: f.text }), trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const exported = await prepareSceneScienceExport(f.doc, { sourceEditing: f.source, sceneFileCount: 1, isOpen: () => useMoleculeStore.getState().documents.includes(f.doc), request: (async () => native.binding({ plugin })) as never });
    expect(exported?.kind).toBe("science"); if (exported?.kind !== "science") throw new Error("Expected paired scientific export");
    const zip: Blob = await native.serialize({ plugin }, exported.action.science, { type: "molx", params: { camera: false, image: false } }); await exported.confirm();
    const decoded = (await decodeScienceSession(new Uint8Array(await zip.arrayBuffer())))!;
    expect(decoded.source.text).toBe(f.text); expect(await decoded.companions![0].file.text()).toBe(await oneBlock().text());
    expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(new Uint8Array(await scientificStateFor(f.doc.id, f.text).original!.file.arrayBuffer()));
  } finally { plugin.dispose(); }

  await f.reopen(); await settle(() => Boolean(f.host.querySelector('table[aria-label="MCD source values"]')));
  const reopened = useMoleculeStore.getState().documents.find(value => value.path === f.doc.path)!;
  expect(reopened).not.toBe(f.doc); expect(documents.readBrowserDevVirtualTextDocument(reopened.path)).toBe(f.text);
  expect(f.source.sessionForDocument(reopened)).toBeNull(); expect(await readBrowserSourceCheckpoint(reopened.path)).toBeNull();
 } finally { await f.close(); }
});

test("attachment selects its separate source once; the user's original-spectrum choice survives owner remount", async () => {
 const f = await pickerFixture("mcd-with-nmr.out", "owner", readFileSync(new URL("./fixtures/quantum/spectra-orca-nmr.out", import.meta.url)));
 try {
  await settle(() => Boolean(f.host.querySelector('table[aria-label="NMR source values"]')));
  await f.choose(oneBlock()); await settle(() => Boolean(f.host.querySelector('table[aria-label="MCD source values"]')));
  const selector = f.host.querySelector<HTMLSelectElement>('select[aria-label="Spectrum source"]')!;
  expect(selector.value).toBe("companion-0"); expect([...selector.options].map(option => option.textContent)).toContain("explicit.mcd");
  const original = [...selector.options].find(option => !option.value.startsWith("companion-"))!.value;
  await act(async () => { selector.value = original; selector.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event); });
  await settle(() => Boolean(f.host.querySelector('table[aria-label="NMR source values"]')));
  await f.remount(); await settle(() => Boolean(f.host.querySelector('table[aria-label="NMR source values"]')));
  expect(f.host.querySelector<HTMLSelectElement>('select[aria-label="Spectrum source"]')!.value).toBe(original);
  expect(documents.readBrowserDevVirtualTextDocument(f.doc.path)).toBe(f.text); expect(await readBrowserSourceCheckpoint(f.doc.path)).toBeNull();
 } finally { await f.close(); }
});

test("Chemical JSON keeps its existing spectra without offering an unsupported companion attachment", async () => {
 const f = await pickerFixture("mcd-ineligible.cjson", "owner", readFileSync(new URL("./fixtures/quantum/spectra-native-nmr.cjson", import.meta.url)));
 try {
  await settle(() => Boolean(f.host.querySelector('table[aria-label="NMR source values"]')));
  expect(Boolean(f.button("Add MCD…"))).toBe(false); expect(await readBrowserScientificAttachment(f.doc.path)).toBeNull();
  expect(f.source.sessionForDocument(f.doc)).toBeNull();
 } finally { await f.close(); }
});
