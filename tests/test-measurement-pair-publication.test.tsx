import { expect, test } from "bun:test";
import { act } from "react";
import { measurementPreviewTarget, measurementPreviewTransfer } from "../apps/desktop/src/lib/workbench/measurement-preview";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
import { fixture, holds } from "./measurement-pair-fixture";

test("failed final validation does not authorize its uncommitted measurement source", async () => {
  const view = await fixture();
  try {
    const history = view.graph.history, edit = view.edit("Rejected metadata");
    expect(await view.apply(edit.operation, { validateBeforeWrite: async () => { throw new Error("The displayed structure changed."); } })).toBeNull();
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(history!.current.text);
    expect(view.graph.history).toBe(history);
    expect(await measurementPreviewTarget(view.doc.id, edit.target)).toBeNull();
    expect(await measurementPreviewTarget(view.doc.id, history!.current.text)).toBeNull();
  } finally { await view.close(); }
});

test("cancel or close while beginEditing reads cannot publish prepared pairs", async () => {
  for (const action of ["cancel", "close"]) {
    const view = await fixture();
    try {
      const before = view.graph.history, edit = view.edit(action), controller = new AbortController();
      holds.read = true; holds.releaseRead = null;
      let pending!: ReturnType<typeof view.graph.apply>;
      await act(async () => { pending = view.graph.apply(edit.operation, { signal: controller.signal }); });
      await view.settle(() => holds.releaseRead !== null);
      expect(await measurementPreviewTarget(view.doc.id, edit.target)).toBeNull();
      if (action === "cancel") controller.abort();
      else await act(async () => { expect(await view.controller.closeDocuments([view.doc.id])).toBe(true); });
      let result;
      await act(async () => { holds.releaseRead!(); result = await pending; });
      expect(result).toBeNull(); expect(view.graph.history).toBe(before);
      expect(view.controller.sessionForDocument(view.doc)?.dirty ?? false).toBe(false);
      expect(await measurementPreviewTarget(view.doc.id, edit.target)).toBeNull();
      expect(await measurementPreviewTarget(view.doc.id, before!.current.text)).toBeNull();
    } finally { holds.read = false; await view.close(); }
  }
});

test("stale content, frame lifetime and read-only state at final validation leave no authorized edge", async () => {
  for (const action of ["source", "frame", "readonly"]) {
    const view = await fixture();
    try {
      await act(async () => view.controller.beginEditing(view.doc));
      const before = view.graph.history!, edit = view.edit(action); let current = true;
      expect(await view.apply(edit.operation, { isCurrent: () => current, validateBeforeWrite: async () => {
        if (action === "source") view.controller.updateDraft(view.doc, before.current.text + "\n", { previewApplied: true });
        else if (action === "readonly") view.controller.sessionForDocument(view.doc)!.editable = false;
        else current = false;
      } })).toBeNull();
      expect(view.controller.sessionForDocument(view.doc)?.content).toBe(before.current.text + (action === "source" ? "\n" : ""));
      expect(await measurementPreviewTarget(view.doc.id, edit.target)).toBeNull();
      expect(await measurementPreviewTarget(view.doc.id, before.current.text)).toBeNull();
    } finally { await view.close(); }
  }
});

test("a thrown or ignored draft write cannot publish, including an ignored byte-identical edit", async () => {
  for (const mode of ["throw", "noop", "same-text"] as const) {
    const view = await fixture();
    try {
      if (mode === "same-text") {
        const seed = view.edit("same").target;
        await act(async () => { await view.controller.beginEditing(view.doc); view.controller.updateDraft(view.doc, seed, { previewApplied: true }); });
        await view.settle(() => view.graph.history?.current.text === seed);
      }
      const before = view.graph.history!, edit = view.edit(mode === "same-text" ? "same" : mode);
      if (mode === "same-text") expect(edit.target).toBe(before.current.text);
      view.setWriteMode(mode === "throw" ? "throw" : "noop");
      expect(await view.apply(edit.operation)).toBeNull();
      expect(view.controller.sessionForDocument(view.doc)?.content).toBe(before.current.text);
      expect(view.graph.history).toBe(before);
      expect(await measurementPreviewTarget(view.doc.id, edit.target)).toBeNull();
    } finally { await view.close(); }
  }
});

test("successful commit authorizes in its first observable microtask and retains one Undo/Redo history", async () => {
  const view = await fixture();
  try {
    const before = view.graph.history!.current, edit = view.edit("Committed");
    const from = await sha256Hex(before.text), target = await sha256Hex(edit.target);
    let observed: unknown;
    view.afterWrite(() => {
      try { observed = measurementPreviewTransfer(view.doc.id, target, { sourceFormat: "sdf", sourceSha256: from, atomCount: 3, items: [] }); }
      catch (error) { observed = error; }
    });
    let committed;
    await act(async () => { committed = await view.focused.apply(edit.operation); });
    expect(committed).not.toBeNull();
    expect(view.dockTabs.at(-1)).toBe("text");
    const after = view.graph.history!.current;
    expect(view.focused.history).toBe(view.graph.history);
    expect(observed).toEqual({ version: 1, sourceFormat: "sdf", targetSourceSha256: target, atomCount: 3, items: [], group: undefined });
    expect(view.graph.history!.undo).toEqual([before]);
    await act(async () => view.graph.undo()); expect(view.graph.history!.current).toBe(before);
    expect(view.focused.history).toBe(view.graph.history);
    expect(await measurementPreviewTarget(view.doc.id, before.text)).toBe(from);
    await act(async () => view.focused.redo()); expect(view.graph.history!.current).toBe(after);
    expect(view.focused.history).toBe(view.graph.history);
    expect(await measurementPreviewTarget(view.doc.id, after.text)).toBe(target);
    const rejected = view.edit("Uncommitted after success");
    expect(await view.apply(rejected.operation, { validateBeforeWrite: async () => { throw new Error("stale"); } })).toBeNull();
    expect(await measurementPreviewTarget(view.doc.id, rejected.target)).toBeNull();
    expect(view.graph.history!.current).toBe(after);
  } finally { await view.close(); }
});

test("held position worker preserves raw SDF/MOL families and never authorizes an expired frame", async () => {
  for (const format of ["sdf", "mol"] as const) for (const expired of [false, true]) {
    const view = await fixture(format);
    try {
      const before = view.graph.history!.current;
      const coordinates = before.structure.atoms.map(atom => [atom.x + 0.2, atom.y, atom.z] as [number, number, number]);
      holds.graph = true; holds.releaseWorker = null;
      let pending!: ReturnType<typeof view.graph.apply>, current = true;
      await act(async () => { pending = view.graph.apply({ kind: "positions", from: before, coordinates }, { isCurrent: () => current }); });
      await view.settle(() => holds.releaseWorker !== null);
      expect(await measurementPreviewTarget(view.doc.id, before.text)).toBeNull();
      current = !expired; let result;
      await act(async () => { holds.releaseWorker!(); result = await pending; });
      if (expired) {
        expect(result).toBeNull(); expect(view.graph.history!.current).toBe(before);
        expect(await measurementPreviewTarget(view.doc.id, before.text)).toBeNull();
      } else {
        expect(result).not.toBeNull(); const after = view.graph.history!.current;
        const target = (await measurementPreviewTarget(view.doc.id, after.text))!;
        expect(measurementPreviewTransfer(view.doc.id, target, { sourceFormat: format, sourceSha256: await sha256Hex(before.text), atomCount: 3, items: [] }).targetSourceSha256).toBe(target);
        expect(() => measurementPreviewTransfer(view.doc.id, target, { sourceFormat: format === "mol" ? "sdf" : "mol", sourceSha256: target, atomCount: 3, items: [] })).toThrow();
      }
    } finally { holds.graph = false; await view.close(); }
  }
});
