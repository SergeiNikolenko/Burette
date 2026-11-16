import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createAgentSourceOwner } from "../apps/desktop/src/lib/workbench/agent-source";
import type { ViewerDocument } from "../apps/desktop/src/types";
const owners: ReturnType<typeof createAgentSourceOwner>[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); });
function source(text: string, extension = "sdf") {
  const document: ViewerDocument = { id: crypto.randomUUID(), title: `source.${extension}`, path: `/source.${extension}`, extension, renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  let value = text;
  const owner = createAgentSourceOwner({ runtime: "browser-agent-shell", documents: () => [document], activeDocument: () => document,
    readSource: async () => ({ text: value, origin: "draft" }), draftsVisible: true }, new AbortController().signal);
  owners.push(owner); return { owner, replace(text: string) { value = text; } };
}
test("the existing source owner retains an exact bounded graph in external atom order", async () => {
  const sdf = readFileSync(new URL("./fixtures/properties/ethanol.sdf", import.meta.url), "utf8"), f = source(sdf);
  const first = await f.owner.snapshotOf({});
  expect(first.structure).toMatchObject({ graphSource: "explicit", graphComplete: true, atoms: [{ element: "C" }, { element: "C" }, { element: "O" }] });
  expect(first.structure!.bonds).toEqual([{ a: 0, b: 1, order: 1 }, { a: 1, b: 2, order: 1 }]);
  expect(first.sourceError).toBeNull();
  const saved = structuredClone(first.structure);
  f.replace(sdf.replace("$$$$", "> <AGENT_NOTE>\nchanged metadata\n\n$$$$"));
  const next = await f.owner.snapshotOf({});
  expect(next.revision).not.toBe(first.revision); expect(next.structure).toEqual(saved); expect(first.structure).toEqual(saved);
  await expect(f.owner.snapshotOf({ expectedSourceRevision: first.revision })).rejects.toThrow("changed");
});
test("graph collection refusal and explicit closed-source cancellation remain intact", async () => {
  const sdf = readFileSync(new URL("./fixtures/properties/ethanol.sdf", import.meta.url), "utf8");
  const f = source(sdf + sdf), snapshot = await f.owner.snapshotOf({});
  expect(snapshot.structure).toBeNull(); expect(snapshot.structureError).toContain("one SDF record");
  const one = source(sdf), old = await one.owner.snapshotOf({});
  one.owner.documentsChanged(new Set());
  expect(() => one.owner.assertOpen(old.document, old.lifetime)).toThrow("closed");
  expect(old.structure!.atoms).toHaveLength(3);
});
