import { createHash } from "node:crypto";
import { readMolstarModule } from "../scripts/molstar-source.mjs";
import { test, expect, act, fixture, click, wait, original, oracle } from "./cube-ui-history-fixture";
import { patchMolstarCubeUiHistory } from "../scripts/molstar-cube-ui-history.mjs";

test("native Cube Update → existing Apply Undo/Redo preserves every field value and the original asset", async () => {
  const f = await fixture();
  try {
    expect(Buffer.byteLength(original)).toBe(504);
    expect(createHash("sha256").update(original).digest("hex")).toBe("50aa03d21a740f26e5af867c52a114a17f2896b1b8a5997059befaeaa2baea1b");
    await f.verify(7); await f.choose(11); await click(f.host, "Update");
    await wait(() => f.cell().params!.values.dataIndex === 1, "native Update completed"); expect(f.api.sizes()).toEqual([1, 0]); await f.verify(11);
    await f.history("Undo"); await wait(() => f.api.sizes()[1] === 1, "Undo completed"); await f.verify(7);
    await f.history("Redo"); await wait(() => f.api.sizes()[1] === 0, "Redo completed"); await f.verify(11);
    await f.choose(17); await click(f.host, "Update"); await wait(() => f.api.sizes()[0] === 2, "second UI history entry"); await f.verify(17);
    await f.history("Undo"); await wait(() => f.api.sizes()[1] === 1, "second Undo"); await f.verify(11);
    await f.choose(7); await click(f.host, "Update"); await wait(() => f.api.sizes()[1] === 0, "new change clears Redo"); await f.verify(7);
    await click(f.bar, "Apply"); expect([...document.querySelectorAll<HTMLButtonElement>(".buret-selection-apply button")].find(button => button.textContent === "Redo")!.disabled).toBe(true);
    expect(f.notifications).toContainEqual({ type: "molstarEditHistoryChanged", canUndo: true, canRedo: false, undoLabel: "Cube dataset", redoLabel: null });
  } finally { await f.close(); }
});

test("customUpdate retains priority and an unregistered host retains the native Cube update path", async () => {
  const f = await fixture();
  try {
    const custom: unknown[] = [];
    await f.render(f.volumeRef, async params => { custom.push(params); await f.plugin.state.updateTransform(f.plugin.state.data, f.volumeRef, params); });
    await f.choose(11); await click(f.host, "Update"); await wait(() => custom.length === 1 && f.cell().params!.values.dataIndex === 1, "custom update");
    await f.verify(11); expect(f.api.sizes()).toEqual([0, 0]);
    delete (f.plugin.customState as { buretteCubeDatasetUpdate?: unknown }).buretteCubeDatasetUpdate;
    await f.render(f.volumeRef); await f.choose(17); await click(f.host, "Update"); await wait(() => f.cell().params!.values.dataIndex === 2, "native fallback");
    await f.verify(17); expect(f.api.sizes()).toEqual([0, 0]); expect(f.plugin.state.data.canUndo).toBe(false);
  } finally { await f.close(); }
});

test("a native non-Cube editor update does not enter Cube scene history", async () => {
  const f = await fixture();
  try {
    const raw = await f.plugin.builders.data.rawData({ data: "unrelated", label: "Before" });
    await f.render(raw.ref);
    const input = f.host.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input).not.toBeNull();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "After"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(f.host, "Update"); await wait(() => raw.cell!.obj!.label === "After", "unrelated native update");
    expect(f.api.sizes()).toEqual([0, 0]); await f.verify(7);
  } finally { await f.close(); }
});

test("the build adapter rejects changed or already adapted upstream editor source", async () => {
  const source = await readMolstarModule("@molstar/plugin-ui/state/update-transform");
  expect(() => patchMolstarCubeUiHistory("changed layout")).toThrow("review Cube UI history");
  expect(() => patchMolstarCubeUiHistory(patchMolstarCubeUiHistory(source))).toThrow("review Cube UI history");
});

test("the existing history limit remains 20 and a retired viewer cannot capture another scene", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 22; i++) {
      const index = (i + 1) % 3;
      await f.choose([7, 11, 17][index]); await click(f.host, "Update");
      await wait(() => f.cell().params!.values.dataIndex === index, "native bounded-history update");
    }
    expect(f.api.sizes()).toEqual([20, 0]); await f.verify(11);
    f.deactivate(); const errors: unknown[] = [], originalError = console.error;
    console.error = (...args) => { errors.push(...args); };
    try { await f.choose(17); await click(f.host, "Update"); await wait(() => errors.length > 0, "retired viewer rejected"); }
    finally { console.error = originalError; }
    expect(errors.some(error => error instanceof Error && error.message === "The Cube viewer is no longer current.")).toBe(true);
    expect(f.api.sizes()).toEqual([20, 0]); await f.verify(11);
  } finally { await f.close(); }
});

test("completion of a retired viewer's real native update cannot enter the next scene's history", async () => {
  for (const retirement of ["viewer", "source"] as const) {
    const f = await fixture();
    try {
      const update = f.plugin.state.updateTransform.bind(f.plugin.state), gate = Promise.withResolvers<void>();
      let completed = false;
      f.plugin.state.updateTransform = async (...args) => { const result = await update(...args); completed = true; await gate.promise; return result; };
      await f.choose(11); await click(f.host, "Update"); await wait(() => completed, "real native update completed before reply");
      await f.verify(11);
      const replacement = retirement === "source" ? await f.replaceSource() : null;
      if (retirement === "viewer") f.deactivate();
      await act(async () => gate.resolve());
      expect(f.api.sizes()).toEqual([0, 0]);
      if (replacement) expect(replacement()).toEqual({ index: 0, values: oracle.fieldValues["7"] });
    } finally { await f.close(); }
  }
});
