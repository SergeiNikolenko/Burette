// The Structure tiles are wider than tall; a molecule is turned so that its long axis lies across them. This runs the
// real RDKit: the angle and the sign of its `rotate` option are a convention of that library.
import { beforeAll, expect, test } from "bun:test";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { depictionLongAxisAngle } from "../apps/desktop/src/lib/depiction-axis";

let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });

function drawnSize(smiles: string, turn: boolean) {
  const mol = rdkit.get_mol(smiles)!;
  try {
    mol.set_new_coords();
    const rotate = turn ? depictionLongAxisAngle(mol.get_molblock()) : 0;
    const svg = mol.get_svg_with_highlights(JSON.stringify({ width: 300, height: 300, padding: 0.1, rotate }));
    const xs: number[] = [], ys: number[] = [];
    for (const bond of svg.matchAll(/class='bond-\d+[^']*' d='M ([\d.-]+),([\d.-]+) L ([\d.-]+),([\d.-]+)/g)) {
      xs.push(Number(bond[1]), Number(bond[3]));
      ys.push(Number(bond[2]), Number(bond[4]));
    }
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  } finally { mol.delete(); }
}

test("a molecule RDKit lays out upright is drawn across the tile", () => {
  // A factor Xa benzamide of the matched-pairs fixture: RDKit's own layout is taller than wide.
  const smiles = "O=C(NCC1CCN(c2ccncc2)CC1)c1cc(Cl)ccc1OCCc1ccc(Br)cc1";
  const upright = drawnSize(smiles, false);
  const turned = drawnSize(smiles, true);
  expect(upright.height).toBeGreaterThan(upright.width);
  expect(turned.width).toBeGreaterThan(2 * turned.height);
});

test("a bond at an angle is laid flat, and a layout that is already across stays as it is", () => {
  expect(drawnSize("*Cl", true).height).toBeLessThan(1);
  expect(drawnSize("*OC", true)).toEqual(drawnSize("*OC", false));
});

test("text without atoms gives no turn", () => {
  expect(depictionLongAxisAngle("")).toBe(0);
});
