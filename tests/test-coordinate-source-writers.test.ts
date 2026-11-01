import { expect, test } from "bun:test";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { setZmatrixReferences } from "../scripts/zmatrix-editing.mjs";
import { readCoordinateInterchange, writeCoordinateInterchangeXyzSource } from "../scripts/coordinate-interchange.mjs";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { zmatrixRevision, withVariable } from "../apps/desktop/src/lib/workbench/zmatrix-draft";
import { openScientificDocument } from "../apps/desktop/src/lib/workbench/generated-document-open";
import { releaseClosedImports, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { useMoleculeStore } from "../apps/desktop/src/stores/molecule-store";
import { openBrowserDevTextDocument, deleteBrowserDevVirtualTextDocument, readBrowserDevVirtualTextDocument } from "../apps/desktop/src/lib/browser-dev-documents";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";

const raw = "# user comment\nC\nX 1 DX\nH 1 R 2 A\nF 1 +R 2 A 3 -P\nDX=1\nR=1.09\nA=109.5\nP=60\nUNUSED=-17.125\n";
function source() {
  const parsed = parseScientificFile("named.zmat", raw);
  const atoms = parsed.atoms.map(({ element, x, y, z }) => ({ element, x: -y + 42.1234567890123, y: x - 12, z: z + 7 }));
  const science = { ...parsed, atoms, frames: [{ atoms, comment: "user comment import-previous", energyHartree: -1 }] };
  const text = "\ufeff" + serializeXyz(atoms, "user comment import-original").replaceAll("\n", "\r\n");
  return { science, text };
}
const body = (text: string) => text.slice(text.indexOf("\n", text.indexOf("\n") + 1) + 1);

test("definition-only revisions preserve exact atom bytes and reopen their full definition", () => {
  const { science, text } = source();
  const definition = withVariable(science.internalCoordinates!, "UNUSED", 8.125);
  const next = zmatrixRevision(science, definition, text, [{ text, document: science }]);
  expect(body(next.text)).toBe(body(text)); expect(next.text.startsWith("\ufeff3\r\n")).toBe(true);
  expect(next.text.split("\r\n")[1].startsWith("user comment import-original ")).toBe(true);
  const read = parseScientificFile("copied.xyz", next.text);
  expect({ atoms: read.atoms, definition: read.internalCoordinates }).toEqual({ atoms: science.atoms, definition });
  expect(science.internalCoordinates!.variables.at(-1)!.value).toBe(-17.125);
  const referenceEdit = setZmatrixReferences(definition, 3, [0, 2, 1]).document;
  const referenced = zmatrixRevision(next.document, referenceEdit, next.text, [{ text, document: science }, next]);
  expect(body(referenced.text)).toBe(body(text));
  expect(readCoordinateInterchange(referenced.text, "xyz").internalCoordinates).toEqual(referenceEdit);

});

test("actual scientific materialization keeps full coordinates/definition, comment, distinct owner and Original", async () => {
  const before = useMoleculeStore.getState().documents, opened: ViewerDocument[] = [];
  const actions: Pick<ShellActions, "openStructureRecords"> = { openStructureRecords: async records => {
    const documents = await Promise.all(records.map(r => openBrowserDevTextDocument(r.path, r.inputExtension, r.text, { ...defaultPreferences, rendererMode: "molstar" })));
    opened.push(...documents); useMoleculeStore.setState(state => ({ documents: [...state.documents, ...documents] })); return documents;
  } };
  const { science } = source(), file = new Blob([raw]);
  science.frames[0].comment = "  user comment import-previous  ";
  try {
    await openScientificDocument(actions, "same.zmat", science, "final", { name: "same.zmat", file });
    await openScientificDocument(actions, "same.zmat", science, "final", { name: "same.zmat", file });
    expect(opened).toHaveLength(2); expect(opened[0].id).not.toBe(opened[1].id);
    for (const document of opened) {
      const text = readBrowserDevVirtualTextDocument(document.path)!;
      const decoded = parseScientificFile("saved.xyz", text), state = scientificStateFor(document.id, text);
      expect({ atoms: decoded.atoms, definition: decoded.internalCoordinates }).toEqual({ atoms: science.atoms, definition: science.internalCoordinates });
      expect(decoded.frames[0].comment).toStartWith("Energy=-1 Hartree   user comment import-previous   import-");
      expect(decoded.frames[0].energyHartree).toBe(-1);
      expect(state.revision!.document).toBe(science); expect(await state.original!.file.text()).toBe(raw);
    }
  } finally {
    for (const document of opened) deleteBrowserDevVirtualTextDocument(document.path);
    useMoleculeStore.setState({ documents: before }); releaseClosedImports(new Set(before.map(document => document.id)));
  }
});


test("comment replacement preserves BOM, individual terminators, padded count and exact row spelling", () => {
  for (const [end, final] of [["\n", "\n"], ["\r\n", "\r\n"], ["\r", "\r"], ["\r\n", ""]]) {
    const text = `\ufeff 2 ${end}Unicode α import-kept zdef-0123abcd${end}H\t+4.2e1  -12.000 7${end}F 42 -12 +8.25000${final}`;
    const pair = readCoordinateInterchange(text, "xyz");
    let next = writeCoordinateInterchangeXyzSource(text, pair, "import-new");
    const untouched = (value: string) => value.replace(/^([^\r\n]*(?:\r\n|\r|\n))[^\r\n]*/u, "$1");
    for (let i = 0; i < 3; i++) {
      const definition = { ...pair.internalCoordinates, variables: [{ name: "UNUSED", value: i }] };
      next = writeCoordinateInterchangeXyzSource(next, { ...pair, internalCoordinates: definition });
      expect(untouched(next)).toBe(untouched(text));
      expect(readCoordinateInterchange(next, "xyz")).toEqual({ ...pair, internalCoordinates: definition, comment: "Unicode α import-kept import-new" });
      expect(next.match(/BURETTE_INTERNAL_COORDINATES_V/gu)).toHaveLength(1);
      expect(next.includes("zdef-0123abcd")).toBe(false);
    }
  }
});

test("managed tiny geometry edits replace the old marker, retain other rows and reopen exactly", () => {
  const initial = parseScientificFile("pair.zmat", "H\nF 1 R\nR=1.25\n");
  const text = writeCoordinateInterchangeXyzSource("2\r\nimport-held\r\nH 0 0 0\r\nF 0 0 1.25", { atoms: initial.atoms, internalCoordinates: initial.internalCoordinates! });
  const first = { text, document: initial };
  const definition = withVariable(initial.internalCoordinates!, "R", 1.2500009);
  const next = zmatrixRevision(initial, definition, text, [first]);
  expect(next.document.atoms[1].z - initial.atoms[1].z).toBeCloseTo(0.0000009, 12);
  expect(next.text.split("\r\n")[2]).toBe("H 0 0 0"); expect(next.text.endsWith("\n")).toBe(false);
  expect(readCoordinateInterchange(next.text, "xyz")).toEqual({ atoms: next.document.atoms, internalCoordinates: definition, comment: "import-held" });
  expect(readCoordinateInterchange(first.text, "xyz").atoms).toEqual(initial.atoms);
  const again = zmatrixRevision(next.document, definition, next.text, [first, next]);
  expect(again.text).toBe(next.text);
});

test("malformed old envelopes, conflicting current rows and output expansion refuse before publication", async () => {
  const { science } = source(), pair = { atoms: science.atoms, internalCoordinates: science.internalCoordinates! };
  const plain = serializeXyz(pair.atoms, "user"), valid = writeCoordinateInterchangeXyzSource(plain, pair);
  for (const bad of [valid.replace("V1=", "V2="), valid.replace("V1=", "V1=="), valid.replace("user ", "BURETTE_INTERNAL_COORDINATES_V1=e30 "), valid.replace("C 42.1234567890123", "C 42.2")]) {
    expect(() => writeCoordinateInterchangeXyzSource(bad, pair)).toThrow();
  }
  let opened = 0;
  const actions: Pick<ShellActions, "openStructureRecords"> = { openStructureRecords: async () => { opened++; return []; } };
  const oversized = { ...science, frames: [{ atoms: science.atoms, comment: "x".repeat(1024 * 1024 - 150) }] };
  await expect(openScientificDocument(actions, "large.zmat", oversized, "final")).rejects.toThrow("1 MiB");
  expect(opened).toBe(0);
});
