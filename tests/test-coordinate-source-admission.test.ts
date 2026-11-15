import { afterEach, expect, test } from "bun:test";
import { writeCoordinateInterchange } from "../scripts/coordinate-interchange.mjs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { admitCoordinateSourceRevision, claimImportedSource, recordImportedRevision, registerImportedScientificSource,
  registeredRevision, releaseClosedImports, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";

const originalText = "H\nF 1 R\nR=1.25\nUNUSED=0\n";
const parsed = parseScientificFile("source.zmat", originalText);
function revision(name: string, unused = 0) {
  const internalCoordinates = { ...parsed.internalCoordinates!, variables: parsed.internalCoordinates!.variables.map(variable => variable.name === "UNUSED" ? { ...variable, value: unused } : variable) };
  const text = writeCoordinateInterchange({ atoms: parsed.atoms, internalCoordinates }, "xyz", name);
  return { text, document: { ...parseScientificFile("source.xyz", text), internalCoordinates } };
}
const original = { name: "original.zmat", file: new Blob([originalText]) };
function imported(id: string) {
  const first = revision(`import-${id}`);
  registerImportedScientificSource(`import-${id}`, first.text, first.document, original); claimImportedSource(`import-${id}`, id);
  return first;
}
afterEach(() => releaseClosedImports(new Set()));

test("explicit parsed-source roots preserve previous revision identities, Original and exact rollback", () => {
  const id = "coordinate-history", first = imported(id), old = scientificStateFor(id, first.text).revisions;
  const source = revision("edited human comment"), admitted = admitCoordinateSourceRevision(id, source);
  expect(scientificStateFor(id, first.text).revisions).toBe(old);
  expect(scientificStateFor(id, source.text).revision).toBe(source);
  expect(scientificStateFor(id, source.text).original).toBe(original);
  const target = revision("edited human comment", 2), undoRecord = recordImportedRevision(id, source.text, target)!;
  expect(scientificStateFor(id, target.text).revisions).toEqual([source, target]);
  expect(scientificStateFor(id, first.text).revisions).toBe(old);
  undoRecord(); admitted.rollback();
  expect(scientificStateFor(id, first.text).revisions).toBe(old);
  expect(scientificStateFor(id, source.text).revision).toBeNull();
  expect(scientificStateFor(id, first.text).original).toBe(original);
});

test("conditional rollback preserves later legitimate records, roots and unrelated documents", () => {
  const id = "coordinate-later", first = imported(id), other = imported("unrelated");
  const a = revision("first parsed root"), pending = admitCoordinateSourceRevision(id, a);
  const b = revision("later parsed root"), later = admitCoordinateSourceRevision(id, b);
  const target = revision("later parsed root", 3); recordImportedRevision(id, b.text, target);
  const owned = scientificStateFor(id, target.text).revisions;
  pending.rollback(); later.rollback();
  expect(scientificStateFor(id, target.text).revisions).toBe(owned);
  expect(scientificStateFor(id, target.text).revision).toBe(target);
  expect(scientificStateFor("unrelated", other.text).revision!.document).toBe(other.document);
  expect(scientificStateFor(id, first.text).original).toBe(original);
  const c = revision("cancelled root"), cancelled = admitCoordinateSourceRevision(id, c);
  recordImportedRevision("unrelated", other.text, revision("unrelated update"));
  cancelled.rollback();
  expect(scientificStateFor(id, c.text).revision).toBeNull();
  expect(scientificStateFor(id, target.text).revisions).toBe(owned);
});

test("all owned coordinate roots share the 100-revision bound and keep the current Undo pair", () => {
  const id = "coordinate-bound", first = imported(id), all = [first];
  for (let i = 0; i < 65; i++) {
    const source = revision(`root-${i}`), target = revision(`root-${i}`, i + 1);
    admitCoordinateSourceRevision(id, source); recordImportedRevision(id, source.text, target);
    all.push(source, target);
    const groups = new Set(all.map(value => scientificStateFor(id, value.text).revisions).filter(Boolean));
    expect([...groups].reduce((sum, values) => sum + values!.length, 0)).toBeLessThanOrEqual(100);
    expect(scientificStateFor(id, target.text).revisions).toEqual([source, target]);
  }
  const present = all.filter(value => registeredRevision(id, value.text));
  const before = present.map(value => scientificStateFor(id, value.text).revisions);
  const pending = admitCoordinateSourceRevision(id, revision("pending at bound"));
  pending.rollback();
  expect(present.map(value => scientificStateFor(id, value.text).revisions)).toEqual(before);
  present.forEach((value, i) => expect(scientificStateFor(id, value.text).revisions).toBe(before[i]));
  expect(scientificStateFor(id, present.at(-1)!.text).original).toBe(original);
});
