import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { fixtureText, fractional, matchSites, reference } from "./crystal-reference";
import { perceivePeriodicBonds } from "../apps/desktop/src/lib/molecular-workbench/periodic-bonds";
import { readUnitCell } from "../apps/desktop/src/lib/molecular-workbench/crystal";
import { parseXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";

const browser = new Window({ url: "http://localhost/" }); Object.assign(browser, { setImmediate, clearImmediate });
Object.assign(globalThis, { window: browser, document: browser.document, localStorage: browser.localStorage });
const { openBrowserDevDocuments } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { readWorkbenchSource } = await import("../apps/desktop/src/lib/workbench/structure");

const files = new Map<string, string>();
globalThis.fetch = Object.assign(async (request: Parameters<typeof fetch>[0]) => {
  const url = new URL(String(request), "http://localhost");
  if (url.pathname === "/__burette/trajectory-pair") return new Response(null, { status: 404 });
  const path = url.searchParams.get("path") ?? decodeURIComponent(url.pathname.replace(/^\/@fs/u, ""));
  const text = files.get(path); if (text === undefined) return new Response(null, { status: 404 });
  return new Response(text, { headers: { "content-type": "text/plain" } });
}, { preconnect: globalThis.fetch.preconnect });

/** Opens a file as the browser shell does and returns what Mol* receives. */
async function open(path: string, text: string) {
  files.set(path, text);
  const result = await openBrowserDevDocuments([path], { ...defaultPreferences, rendererMode: "auto" } as never);
  expect(result.errors).toEqual([]);
  const document = result.documents[0];
  const config = JSON.parse(/window\.BuretteConfig\s*=\s*(\{[^\n]*?\});/u.exec(document.runtimePath!)![1]);
  const data = atob(/window\.BuretteDataBase64 = "([^"]*)"/u.exec(document.runtimePath!)![1]);
  return { document, config, data: new TextDecoder().decode(Uint8Array.from(data, (c) => c.charCodeAt(0))) };
}

test.each([["/crystals/urea.cif", "urea.cif"], ["/crystals/CONTCAR", "CONTCAR"], ["/crystals/si.vasp", "si.poscar"], ["/vasp/POSCAR", "si.poscar"]])("%s reaches Mol* as its full cell with an exact Lattice", async (path, fixture) => {
  const { document, config, data } = await open(path, fixtureText(fixture));
  expect([document.extension, document.renderer, config.format]).toEqual([path.endsWith(".cif") ? "cif" : "vasp", "molstar", "xyz"]);
  const cell = readUnitCell(data)!, { atoms } = parseXyz(data);
  const expected = reference.fixtures[fixture];
  expect(atoms).toHaveLength(expected.atomCount);
  expect(Math.abs(cell[0][0] * (cell[1][1] * cell[2][2] - cell[1][2] * cell[2][1]) - cell[0][1] * (cell[1][0] * cell[2][2] - cell[1][2] * cell[2][0]) + cell[0][2] * (cell[1][0] * cell[2][1] - cell[1][1] * cell[2][0]))).toBeCloseTo(expected.volume, 6);
  matchSites(atoms, cell, expected.sites);
  // The workbench reads the same atoms in the same places as the viewer shows them.
  const source = await readWorkbenchSource(document, fixtureText(fixture));
  expect(source.atoms.map((atom) => atom.element)).toEqual(atoms.map((atom) => atom.element));
  source.atoms.forEach((atom, index) => ["x", "y", "z"].forEach((axis) => expect(atom[axis as "x"]).toBeCloseTo(atoms[index][axis as "x"], 9)));
});

test("urea opens with both molecules whole: no bond of the converted cell crosses a face", async () => {
  const { data } = await open("/crystals/urea-whole.cif", fixtureText("urea.cif"));
  const cell = readUnitCell(data)!, { atoms } = parseXyz(data);
  const bonds = perceivePeriodicBonds(atoms, cell);
  expect(bonds).toHaveLength(reference.fixtures["urea.cif"].periodicBonds!.bonds.length);
  expect(bonds.every((bond) => bond.image.every((value) => value === 0))).toBe(true);
  // Atoms moved by whole cells only, from where the CIF expansion put them.
  atoms.forEach((atom) => fractional([atom.x, atom.y, atom.z], cell).forEach((value) => expect(Number.isFinite(value)).toBe(true)));
});

test("a CIF the crystal reader refuses keeps the asymmetric-unit preview; macromolecular mmCIF is untouched", async () => {
  const partial = fixtureText("urea.cif").replace("O4  2  0.00000000  0.50000000  0.59530000  1", "O4  2  0.00000000  0.50000000  0.59530000  0.5");
  const refused = await open("/crystals/partial.cif", partial);
  expect(refused.config.format).toBe("pdb");
  expect(refused.data).not.toContain("Lattice=");
  const mmcif = "data_1ABC\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\nATOM 1 N N GLY A 1 0.0 0.0 0.0\n";
  const macromolecule = await open("/structures/protein.cif", mmcif);
  expect(macromolecule.config.format).not.toBe("xyz");
});
