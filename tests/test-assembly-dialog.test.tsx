import { createRequire } from "node:module";
import { act, test, expect, fixture, dialog, button, click, select, wait, prepared, holdPreparation, releasePreparation,
  readBrowserDevVirtualTextDocument, openWorkbenchDialog, closeWorkbenchDialog, useMoleculeStore, compiler, browser } from "./assembly-dialog-fixture";
const require = createRequire(import.meta.url);
const { CIF } = require("molstar/lib/commonjs/mol-io/reader/cif.js");
const { trajectoryFromMmCIF } = require("molstar/lib/commonjs/mol-model-formats/structure/mmcif.js");

async function chooseModel() { await wait(() => Boolean(dialog()?.querySelector('select[aria-label="Model"]')), "source models ready"); await select("Model", "2"); expect(button("Build").disabled).toBe(false); }
async function prepare() { const before = prepared.length; holdPreparation(); await chooseModel(); await click("Build"); await wait(() => prepared.length > before, "generated document preparing"); return prepared.at(-1)!; }

test("compiled assembly controls → real worker → independent generated documents and native mmCIF reopen", async () => {
  const f = await fixture();
  try {
    expect(button("Build").disabled).toBe(true); await chooseModel(); await click("Build");
    await wait(() => f.opened.length === 1, "first assembly");
    const text = readBrowserDevVirtualTextDocument(f.opened[0].path)!;
    const parsed = await CIF.parse(text).run(); expect(parsed.isError).toBe(false);
    const model = (await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative;
    expect({ atoms: model.atomicHierarchy.atoms._rowCount, chains: model.atomicHierarchy.chains.auth_asym_id.toArray(), x: Array.from(model.atomicConformation.x) })
      .toEqual({ atoms: 2, chains: ["Z_A1", "Z_A2"], x: [21, 26] });
    await click("Done"); await f.open(); await chooseModel(); await click("Build");
    await wait(() => f.opened.length === 2, "second independent assembly");
    expect(f.opened[0].id).not.toBe(f.opened[1].id); expect(f.opened[0].path).not.toBe(f.opened[1].path);
    expect(readBrowserDevVirtualTextDocument(f.opened[1].path)).toBe(text);
    expect(readBrowserDevVirtualTextDocument(f.source.path)).toBe(f.sourceText);
    expect(compiler).toContain("assembly-dialog.tsx"); expect(compiler).toContain("assembly-dialog-host.tsx");
  } finally { await f.close(); }
});

for (const phase of ["cancel", "dialog-close", "request-replace", "source-close", "document-ABA", "draft-ABA"] as const) test(`${phase} during actual preparation cannot publish an assembly`, async () => {
  const f = await fixture();
  try {
    if (phase === "draft-ABA") { await act(async () => f.editing.beginEditing(f.source, "text")); expect(f.sourceErrors).toEqual([]); expect(f.editing.sessionForDocument(f.source)).not.toBeNull(); }
    const pending = await prepare();
    if (phase === "cancel") await click("Cancel");
    else if (phase === "dialog-close") await act(async () => closeWorkbenchDialog());
    else if (phase === "request-replace") await act(async () => openWorkbenchDialog({ kind: "assembly", document: f.source }));
    else if (phase === "source-close") await act(async () => useMoleculeStore.setState({ documents: [] }));
    else if (phase === "document-ABA") await act(async () => { useMoleculeStore.setState({ documents: [{ ...f.source }] }); useMoleculeStore.setState({ documents: [f.source] }); });
    else await act(async () => { f.editing.updateDraft(f.source, f.sourceText + "\n# changed\n", { previewApplied: true }); f.editing.updateDraft(f.source, f.sourceText, { previewApplied: true }); });
    await act(async () => releasePreparation());
    await wait(() => readBrowserDevVirtualTextDocument(pending.path) === null, "unpublished generated source released");
    expect(f.opened).toEqual([]); expect(useMoleculeStore.getState().documents.some(doc => doc.id === pending.id)).toBe(false);
    expect(readBrowserDevVirtualTextDocument(f.source.path)).toBe(f.sourceText);
  } finally { await f.close(); }
});


test("accepting a chosen file retires a held document-source build before React commits", async () => {
  const f = await fixture();
  try {
    await click("Choose file…");
    const picker = browser.document.querySelector('input[type="file"]')!;
    expect(picker).not.toBeNull();
    const pending = await prepare();
    await act(async () => {
      Object.defineProperty(picker, "files", { configurable: true, value: [new File([f.sourceText], "replacement.cif")] });
      picker.dispatchEvent(new browser.Event("change", { bubbles: true }));
      releasePreparation();
    });
    await wait(() => readBrowserDevVirtualTextDocument(pending.path) === null, "retired source cannot publish");
    expect(f.opened).toEqual([]);
    expect(dialog()!.textContent).toContain("replacement.cif");
    expect(readBrowserDevVirtualTextDocument(f.source.path)).toBe(f.sourceText);
  } finally { await f.close(); }
});
