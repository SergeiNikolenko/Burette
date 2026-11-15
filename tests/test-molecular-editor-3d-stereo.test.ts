import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { importStructure } from "../apps/desktop/src/lib/molecular-codecs";

const core = "../apps/molecular-frame/src/components/molecular/molecule-editor/core/";
const editorModule = await import(core + "molecule_editor.js");
editorModule.initSync({ module: readFileSync(new URL(core + "molecule_editor_bg.wasm", import.meta.url)) });

// L-alanine as RDKit writes a 3D record: a wedge on the centre, chiral flag 0.
const alanine3d = `alanine
     RDKit          3D

 13 12  0  0  0  0  0  0  0  0999 V2000
   -0.9525   -1.0520   -0.1480 C   0  0  0  0  0  0  0  0  0  0  0  0
   -0.2193    0.1582    0.4230 C   0  0  2  0  0  0  0  0  0  0  0  0
   -0.7176    1.3708   -0.1945 N   0  0  0  0  0  0  0  0  0  0  0  0
    1.2401   -0.0287    0.2790 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.7313   -1.0818    0.8052 O   0  0  0  0  0  0  0  0  0  0  0  0
    2.0617    0.8846   -0.3932 O   0  0  0  0  0  0  0  0  0  0  0  0
   -1.0894   -0.9311   -1.2408 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.3808   -1.9850    0.0049 H   0  0  0  0  0  0  0  0  0  0  0  0
   -1.8963   -1.1558    0.4160 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.4445    0.2150    1.4991 H   0  0  0  0  0  0  0  0  0  0  0  0
   -1.6491    1.5749    0.2325 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.7382    1.3392   -1.2300 H   0  0  0  0  0  0  0  0  0  0  0  0
    3.0546    0.6916   -0.4530 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  1  0
  2  4  1  0
  4  5  2  0
  4  6  1  0
  1  7  1  0
  1  8  1  0
  1  9  1  0
  2 10  1  1
  3 11  1  0
  3 12  1  0
  6 13  1  0
M  END
`;

test("a 3D record with relative-stereo flag opens in the editor with its geometry's configuration", async () => {
  const raw = new editorModule.Editor();
  expect(() => raw.load(alanine3d)).toThrow(/relative stereochemistry/);
  const editor = new editorModule.Editor();
  editor.load(await importStructure(alanine3d));
  expect(editor.smiles()).toBe("C[C@H](N)C(=O)O");
});

test("a flat record keeps its chiral flag", async () => {
  const flat = alanine3d.replace(/(-?\d+\.\d{4}) {1,4}([ -]\d+\.\d{4})\s+-?\d+\.\d{4}/g, (_, x, y) => `${x}${y.padStart(10)}    0.0000`);
  expect((await importStructure(flat)).split("\n")[3]).toBe(alanine3d.split("\n")[3]);
});
