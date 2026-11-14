// Enumerate Library against RDKit. The expected products come from RDKit's own
// EnumerateLibraryFromReaction and molzip (tests/fixtures/library-enumeration,
// reference.py); the functions under test are the ones the enumeration worker
// calls, run here with the RDKit WASM the app ships.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { MainModule as RDKitModule } from "@rdkit/rdkit";

import { parseSdfCollectionRecords } from "../apps/desktop/src/lib/collection-documents";
import {
  coreAttachmentLabels,
  enumerateLibrary,
  LIBRARY_PRODUCT_LIMIT,
  LibraryInputError,
  libraryToSdf,
  reactionReactantTemplates,
  type LibraryBuildingBlock,
} from "../apps/desktop/src/lib/library-enumeration.mjs";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/library-enumeration/${name}`, import.meta.url), "utf8");

type Expected = {
  amidation: string;
  amides: Array<{ smiles: string; reactants: string[]; rows: number[] }>;
  core: string;
  coreLibrary: Array<{ smiles: string; groups: string[] }>;
};
const expected = JSON.parse(fixture("expected.json")) as Expected;

// The way the dialog reads a pasted list or a .smi collection: one SMILES per
// line, and the source names the list and the row.
function blocks(file: string): LibraryBuildingBlock[] {
  return fixture(file).split("\n").filter((line) => line.trim()).map((line, index) => ({
    smiles: line.split(/\s+/u)[0],
    source: `${file} #${index + 1}`,
  }));
}

let rdkit: RDKitModule;
beforeAll(async () => {
  const loader = await import("@rdkit/rdkit");
  rdkit = await (loader.default as unknown as () => Promise<RDKitModule>)();
});

function canonical(smiles: string) {
  const molecule = rdkit.get_mol(smiles)!;
  try { return molecule.get_smiles(); } finally { molecule.delete(); }
}

describe("reaction library", () => {
  test("3 acids x 4 amines give RDKit's 12 amides, each with its acid and amine", () => {
    const progress: Array<[number, number]> = [];
    const library = enumerateLibrary(rdkit, {
      mode: "reaction",
      reaction: expected.amidation,
      reactionName: "Amidation",
      positions: [blocks("acids.smi"), blocks("amines.smi")],
    }, { onProgress: (done, total) => progress.push([done, total]) });

    expect(library.products.map((product) => product.smiles)).toEqual(expected.amides.map((amide) => amide.smiles));
    expect(library.products.map((product) => product.parts)).toEqual(expected.amides.map((amide) => [
      { smiles: canonical(amide.reactants[0]), source: `acids.smi #${amide.rows[0]}` },
      { smiles: canonical(amide.reactants[1]), source: `amines.smi #${amide.rows[1]}` },
    ]));
    expect({ ...library, products: library.products.length }).toEqual({
      schemeLabel: "Reaction",
      scheme: "Amidation",
      positions: [
        { label: "Reactant 1", used: 3, unreadable: 0, unmatched: 0 },
        { label: "Reactant 2", used: 4, unreadable: 0, unmatched: 0 },
      ],
      products: 12,
      combinations: 12,
      duplicates: 0,
      withoutProduct: 0,
      capped: false,
    });
    expect(progress.length).toBe(12);
    expect(progress.at(-1)).toEqual([12, 12]);
  });

  test("the library opens as a collection whose rows name the reaction and both reactants", () => {
    const library = enumerateLibrary(rdkit, {
      mode: "reaction",
      reaction: expected.amidation,
      positions: [blocks("acids.smi"), blocks("amines.smi")],
    });
    const records = parseSdfCollectionRecords(libraryToSdf(library));
    expect(records.length).toBe(12);
    expect(records[6].name).toBe("Product 7");
    expect(records[6].props).toEqual({
      Reaction: expected.amidation,
      "Reactant 1": "O=C(O)c1ccccc1",
      "Reactant 1 source": "acids.smi #2",
      "Reactant 2": "C1COCCN1",
      "Reactant 2 source": "amines.smi #3",
    });
    // Each record carries a drawn structure that reads back as its product.
    expect(records.map((record) => canonical(record.molblock))).toEqual(expected.amides.map((amide) => amide.smiles));
  });

  test("a repeated building block gives each product once and counts the rest as duplicates", () => {
    const acids = [...blocks("acids.smi"), { smiles: "OC(C)=O", source: "pasted #4" }];
    const library = enumerateLibrary(rdkit, {
      mode: "reaction",
      reaction: expected.amidation,
      positions: [acids, blocks("amines.smi")],
    });
    expect(library.combinations).toBe(16);
    expect(library.duplicates).toBe(4);
    expect(new Set(library.products.map((product) => product.smiles))).toEqual(new Set(expected.amides.map((amide) => amide.smiles)));
    // The first combination to reach a product is the one it records.
    expect(library.products[0].parts[0].source).toBe("acids.smi #1");
  });

  test("reactants that cannot react are skipped and counted", () => {
    const acids = [
      { smiles: "CCO", source: "ethanol" },
      ...blocks("acids.smi"),
      { smiles: "C1CC", source: "unclosed ring" },
      { smiles: "", source: "empty row" },
    ];
    // The amidation template leaves an amide nitrogen alone.
    const amines = [...blocks("amines.smi"), { smiles: "CC(=O)N", source: "acetamide" }];
    const library = enumerateLibrary(rdkit, {
      mode: "reaction",
      reaction: expected.amidation,
      positions: [acids, amines],
    });
    expect(library.positions).toEqual([
      { label: "Reactant 1", used: 3, unreadable: 2, unmatched: 1 },
      { label: "Reactant 2", used: 4, unreadable: 0, unmatched: 1 },
    ]);
    expect(library.products.map((product) => product.smiles)).toEqual(expected.amides.map((amide) => amide.smiles));

    const none = enumerateLibrary(rdkit, {
      mode: "reaction",
      reaction: expected.amidation,
      positions: [[{ smiles: "CCO", source: "ethanol" }], blocks("amines.smi")],
    });
    expect(none.products).toEqual([]);
    expect(none.combinations).toBe(0);
    expect(none.positions[0]).toEqual({ label: "Reactant 1", used: 0, unreadable: 0, unmatched: 1 });
  });

  test("several matches in one combination become separate products", () => {
    const library = enumerateLibrary(rdkit, {
      mode: "reaction",
      reaction: expected.amidation,
      positions: [[{ smiles: "CC(=O)O", source: "acid" }], [{ smiles: "NCC(C)CCN", source: "diamine" }]],
    });
    expect(library.products.map((product) => product.smiles).sort()).toEqual(
      [canonical("CC(=O)NCC(C)CCN"), canonical("CC(=O)NCCC(C)CN")].sort(),
    );
    expect(library.duplicates).toBe(0);
  });

  test("a reaction is refused before it runs when it is malformed or has the wrong number of lists", () => {
    const acids = blocks("acids.smi");
    expect(() => enumerateLibrary(rdkit, { mode: "reaction", reaction: expected.amidation, positions: [acids] }))
      .toThrow("This reaction takes 2 reactant lists.");
    expect(() => enumerateLibrary(rdkit, { mode: "reaction", reaction: "CC(=O)O", positions: [acids] }))
      .toThrow("A reaction reads reactants>agents>products.");
    expect(() => enumerateLibrary(rdkit, { mode: "reaction", reaction: "[C:1]((>>[C:1]", positions: [acids] }))
      .toThrow("Could not read the reaction SMARTS.");
    expect(() => enumerateLibrary(rdkit, { mode: "reaction", reaction: expected.amidation, positions: [acids, []] }))
      .toThrow(LibraryInputError);
  });

  test("the product count is bounded before anything runs", () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => ({ smiles: "CC(=O)O", source: `#${index + 1}` }));
    expect(LIBRARY_PRODUCT_LIMIT).toBe(2000);
    let ran = 0;
    expect(() => enumerateLibrary(rdkit, {
      mode: "reaction",
      reaction: expected.amidation,
      positions: [many(41), many(49)],
    }, { onProgress: () => { ran += 1; } })).toThrow("A library holds up to 2,000 products; this one would have 2,009.");
    expect(ran).toBe(0);
  });
});

describe("core library", () => {
  test("a core with two R positions and 2 x 3 groups matches RDKit molzip", () => {
    const library = enumerateLibrary(rdkit, {
      mode: "core",
      core: expected.core,
      positions: [blocks("r1.smi"), blocks("r2.smi")],
    });
    expect(library.products.map((product) => product.smiles)).toEqual(expected.coreLibrary.map((row) => row.smiles));
    expect(library.products.map((product) => product.parts.map((part) => part.source))).toEqual([
      ["r1.smi #1", "r2.smi #1"], ["r1.smi #1", "r2.smi #2"], ["r1.smi #1", "r2.smi #3"],
      ["r1.smi #2", "r2.smi #1"], ["r1.smi #2", "r2.smi #2"], ["r1.smi #2", "r2.smi #3"],
    ]);
    expect(library.schemeLabel).toBe("Core");
    expect(library.scheme).toBe(canonical(expected.core));
    expect(library.positions.map((position) => position.label)).toEqual(["R1", "R2"]);
    // The group is recorded with the position it filled.
    expect(library.products[5].parts.map((part) => part.smiles)).toEqual([canonical("Cl[*:1]"), canonical("FC(F)(F)[*:2]")]);

    const record = parseSdfCollectionRecords(libraryToSdf(library))[5];
    expect(record.props).toEqual({
      Core: canonical(expected.core),
      R1: canonical("Cl[*:1]"),
      "R1 source": "r1.smi #2",
      R2: canonical("FC(F)(F)[*:2]"),
      "R2 source": "r2.smi #3",
    });
  });

  test("attachment points are read however they are written", () => {
    const expectedProducts = expected.coreLibrary.map((row) => row.smiles);
    for (const core of ["[1*]c1ccc([2*])cc1", "[R1]c1ccc([R2])cc1", "c1cc([*:2])ccc1[*:1]"]) {
      const library = enumerateLibrary(rdkit, {
        mode: "core",
        core,
        positions: [
          [{ smiles: "C[*:7]", source: "a" }, { smiles: "[R1]Cl", source: "b" }],
          [{ smiles: "[3*]O", source: "c" }, { smiles: "N*", source: "d" }, { smiles: "FC(F)(F)[*]", source: "e" }],
        ],
      });
      expect(library.products.map((product) => product.smiles)).toEqual(expectedProducts);
    }
    expect(coreAttachmentLabels("*c1ccccc1")).toEqual([1]);
    expect(coreAttachmentLabels("[*:3]c1ccc([*:1])cc1")).toEqual([1, 3]);
    expect(() => coreAttachmentLabels("c1ccccc1")).toThrow("Mark the attachment points in the core, for example [*:1].");
    expect(() => coreAttachmentLabels("*c1ccc(*)cc1")).toThrow("Number every attachment point, for example [*:1] and [*:2].");
    expect(() => coreAttachmentLabels("[*:1]c1ccc([*:1])cc1")).toThrow("Each R position can appear once in the core.");
  });

  test("a symmetric core gives each product once", () => {
    const groups = [{ smiles: "*C", source: "methyl" }, { smiles: "*Cl", source: "chloro" }];
    const library = enumerateLibrary(rdkit, { mode: "core", core: expected.core, positions: [groups, groups] });
    expect(library.combinations).toBe(4);
    expect(library.duplicates).toBe(1);
    expect(library.products.map((product) => product.smiles)).toEqual(
      ["Cc1ccc(C)cc1", "Cc1ccc(Cl)cc1", "Clc1ccc(Cl)cc1"].map(canonical),
    );
  });

  test("building blocks without exactly one attachment point are skipped and counted", () => {
    const library = enumerateLibrary(rdkit, {
      mode: "core",
      core: "[*:1]c1ccccc1",
      positions: [[
        { smiles: "*C", source: "methyl" },
        { smiles: "CC", source: "no attachment point" },
        { smiles: "*CC*", source: "two attachment points" },
        { smiles: "*C1CC", source: "unclosed ring" },
      ]],
    });
    expect(library.positions).toEqual([{ label: "R1", used: 1, unreadable: 1, unmatched: 2 }]);
    expect(library.products.map((product) => product.smiles)).toEqual(["Cc1ccccc1"]);
  });

  test("a drawn building block is attached the same way as a typed one", () => {
    const drawn = rdkit.get_mol("*OC")!;
    const molblock = drawn.get_molblock();
    drawn.delete();
    const library = enumerateLibrary(rdkit, {
      mode: "core",
      core: "[*:1]c1ccccc1",
      positions: [[{ molblock, source: "sketch" }]],
    });
    expect(library.products.map((product) => product.smiles)).toEqual(["COc1ccccc1"]);
  });
});

test("reactant templates split at top-level dots only", () => {
  expect(reactionReactantTemplates(expected.amidation)).toEqual([
    "[C:1](=[O:2])[OH]",
    "[N;!$(N=*);!$(N-[!#6;!#1]);!$(N-C=[O,N,S]):3]",
  ]);
  expect(reactionReactantTemplates("[c:1][Br,I,Cl].[c:2][B]([OH])[OH]>[Pd]>[c:1][c:2]").length).toBe(2);
  expect(reactionReactantTemplates("([C:1]=O.[N:2])>>[C:1][N:2]").length).toBe(1);
  expect(reactionReactantTemplates("[C:1]=O.>>[C:1]")).toEqual([]);
  expect(reactionReactantTemplates("CCO")).toEqual([]);
});
