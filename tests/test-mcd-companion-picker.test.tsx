import { act, expect, test, browser, pickerFixture, settle, sidecar, deferred, scientificStateFor, readBrowserScientificAttachment, readBrowserSourceCheckpoint, documents, useMoleculeStore } from "./mcd-picker-fixture";

test("capture precedes the real picker; multiple blocks require explicit Add and keep the source clean", async () => {
 const f = await pickerFixture("picker-blocks.fchk");
 try {
  await f.choose(sidecar()); await settle(() => Boolean(f.host.querySelector("select")));
  expect(await readBrowserScientificAttachment(f.doc.path)).toBeNull(); expect(f.button("Add").disabled).toBe(true);
  const select = f.host.querySelector("select")!;
  await act(async () => { select.value = "1"; select.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event); });
  await act(async () => { f.button("Add").click(); f.button("Add").click(); }); await settle(() => f.attached.length === 1);
  const saved = (await readBrowserScientificAttachment(f.doc.path))!, signal = saved.science.frames[0].mcdCompanion!.spectra.spectra[0];
  if (signal.kind !== "mcd") throw new Error("Expected MCD");
  expect(signal.values).toEqual([-.5]); expect(saved.text).toBe(f.text);
  expect([f.source.sessionForDocument(f.doc), await readBrowserSourceCheckpoint(f.doc.path)]).toEqual([null, null]);
  expect(documents.readBrowserDevVirtualTextDocument(f.doc.path)).toBe(f.text);
 } finally { await f.close(); }
});

test("single gzip block applies selected bytes and picker cancellation has no publication", async () => {
 const f = await pickerFixture("picker-gzip.fchk");
 try {
  await f.choose(); expect(f.attached).toEqual([]); expect(await readBrowserScientificAttachment(f.doc.path)).toBeNull();
  const { gzipSync } = await import("node:zlib"), bytes = new Uint8Array(gzipSync(Buffer.from("10000 -2.25 .12\r\n12000 1.5 .25\r\n")));
  f.captures.length = 0; await f.choose(new File([bytes], "selected.mcd.gz")); await settle(() => f.attached.length === 1);
  const saved = (await readBrowserScientificAttachment(f.doc.path))!;
  expect(new Uint8Array(await saved.companions[0].file.arrayBuffer())).toEqual(bytes);
  expect(f.host.querySelector("select")).toBeNull(); expect(saved.companions[0].name).toBe("selected.mcd.gz");
 } finally { await f.close(); }
});

test("cancelled file reads and replaced owners cannot publish an attachment", async () => {
 for (const change of ["cancel", "replace"] as const) {
  const f = await pickerFixture(`picker-${change}.fchk`), gate = deferred(); let entered = false;
  try {
   const file = sidecar(), read = file.text.bind(file); file.text = async () => { entered = true; await gate.promise; return read(); };
   await f.choose(file); await settle(() => entered);
   if (change === "cancel") await act(async () => f.button("Cancel").click());
   else await act(async () => useMoleculeStore.getState().setDocuments([{ ...f.doc }]));
   await act(async () => { gate.resolve(); await new Promise(resolve => setTimeout(resolve, 10)); });
   expect(f.attached).toEqual([]); expect(await readBrowserScientificAttachment(f.doc.path)).toBeNull();
   expect(scientificStateFor(f.doc.id, f.text).companions).toBeUndefined();
  } finally { gate.resolve(); await f.close(); }
 }
});

test("invalid files and a mismatched Original report failure without replacing saved companion data", async () => {
 const f = await pickerFixture("picker-invalid.fchk");
 try {
  const valid = new File(["10000 -2.25 .12\n"], "kept.mcd");
  await f.choose(valid); await settle(() => f.attached.length === 1);
  const before = (await readBrowserScientificAttachment(f.doc.path))!;
  f.captures.length = 0; await f.choose(new File(["not a spectrum"], "bad.mcd")); await settle(() => Boolean(f.host.querySelector('[role="alert"]')));
  expect(f.host.querySelector('[role="alert"]')!.textContent).toBe("The MCD file could not be read. Check the file and try again.");
  expect((await readBrowserScientificAttachment(f.doc.path))!.id).toBe(before.id); expect(f.attached).toHaveLength(1);
 } finally { await f.close(); }
 const changed = await pickerFixture("picker-original-changed.fchk");
 try {
  const { openBrowserImportDatabase, readBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
  const original = (await readBrowserImport(changed.doc.path))!, bytes = new Uint8Array(await original.file.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  const db = await openBrowserImportDatabase();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put({ ...original, file: new Blob([bytes]) }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  await changed.choose(sidecar()); await settle(() => Boolean(changed.host.querySelector('[role="alert"]')));
  expect(changed.host.querySelector('[role="alert"]')!.textContent).toBe("The original document changed. Reopen it before adding MCD.");
  expect(changed.attached).toEqual([]); expect(await readBrowserScientificAttachment(changed.doc.path)).toBeNull();
 } finally { await changed.close(); }
});

test("a cancelled block choice is not an attachment and source edits retire eligibility", async () => {
 const f = await pickerFixture("picker-block-cancel.fchk");
 try {
  await f.choose(sidecar()); await settle(() => Boolean(f.host.querySelector("select")));
  await act(async () => f.button("Cancel").click());
  expect(f.attached).toEqual([]); expect(await readBrowserScientificAttachment(f.doc.path)).toBeNull();
  await act(async () => { await f.source.beginEditing(f.doc); f.source.updateDraft(f.doc, f.text + "\n", { previewApplied: true }); });
  await settle(() => !f.button("Add MCD…")); expect(f.source.sessionForDocument(f.doc)?.dirty).toBe(true);
 } finally { await f.close(); }
});
