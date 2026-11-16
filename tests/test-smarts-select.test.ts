import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { smartsMatchAtoms } from "../apps/desktop/src/lib/molecular-workbench/smarts-match";

let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
// O 0, CH2 1, CH3 2, then H: 3 and 4 on C1, 5–7 on C2, 8 on O.
const ethanol = readFileSync(new URL("./fixtures/fragments/ethanol-cid702.sdf", import.meta.url), "utf8");

test("SMARTS matches return the file's own atom numbers, hydrogens included", () => {
  expect(smartsMatchAtoms(rdkit, ethanol, "[OX2H]")).toEqual([0]);
  expect(smartsMatchAtoms(rdkit, ethanol, "[CH3]")).toEqual([2]);
  // Every occurrence joins one selection: both carbons and the oxygen of C–C–O.
  expect(smartsMatchAtoms(rdkit, ethanol, "CCO")).toEqual([0, 1, 2]);
  expect(smartsMatchAtoms(rdkit, ethanol, "[#1]")).toEqual([3, 4, 5, 6, 7, 8]);
  expect(smartsMatchAtoms(rdkit, ethanol, "[OX2H][#1]")).toEqual([0, 8]);
  expect(smartsMatchAtoms(rdkit, ethanol, "c")).toEqual([]);
});

test("an empty or invalid pattern is refused before matching", () => {
  expect(() => smartsMatchAtoms(rdkit, ethanol, "  ")).toThrow("Enter a SMARTS pattern.");
  expect(() => smartsMatchAtoms(rdkit, ethanol, "C(")).toThrow("This is not a valid SMARTS pattern.");
});
