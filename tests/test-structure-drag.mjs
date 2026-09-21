#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  STRUCTURE_DRAG_MIME,
  hasStructureDrag,
  readStructureDrag,
  readStructureDragPayload,
  structureDragMovementExceedsThreshold,
  structureDragPayloadFromText,
  structureDragPayloadFromBrowserFiles,
  structureDragRecordsToFragments,
  writeStructureDrag,
  writeStructureDragRecords,
} = await import("../apps/desktop/src/lib/structure-drag.ts");

assert.equal(structureDragMovementExceedsThreshold(
  { x: 20, y: 30 },
  { x: 25, y: 35 },
), false);
assert.equal(structureDragMovementExceedsThreshold(
  { x: 20, y: 30 },
  { x: 29, y: 30 },
), true);

class FakeDataTransfer {
  constructor({ files = [] } = {}) {
    this.store = new Map();
    this.files = files;
    this.effectAllowed = "none";
  }

  get types() {
    return [...this.store.keys(), ...(this.files.length > 0 ? ["Files"] : [])];
  }

  setData(type, value) {
    this.store.set(type, value);
  }

  getData(type) {
    return this.store.get(type) ?? "";
  }
}

function file(path) {
  return { path };
}

const explicit = new FakeDataTransfer();
explicit.setData(STRUCTURE_DRAG_MIME, JSON.stringify({
  paths: ["/tmp/a.sdf", "/tmp/a.sdf", " ", "/tmp/b.pdb"],
  records: [
    { path: "", inputExtension: ".sdf", text: "mol\nM  END\n$$$$\n" },
    { path: "empty.sdf", inputExtension: "sdf", text: "   " },
  ],
}));
assert.equal(hasStructureDrag(explicit), true);
assert.deepEqual(readStructureDrag(explicit), ["/tmp/a.sdf", "/tmp/b.pdb"]);
assert.deepEqual(readStructureDragPayload(explicit), {
  paths: ["/tmp/a.sdf", "/tmp/b.pdb"],
  records: [{ path: "structure.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$" }],
});

const written = new FakeDataTransfer();
writeStructureDrag(written, [" /tmp/a.pdb ", "", "/tmp/a.pdb", "/tmp/b.sdf"]);
assert.equal(written.effectAllowed, "copy");
assert.deepEqual(readStructureDragPayload(written).paths, ["/tmp/a.pdb", "/tmp/b.sdf"]);
assert.equal(written.getData("text/plain"), "/tmp/a.pdb\n/tmp/b.sdf");

const writtenRecords = new FakeDataTransfer();
assert.equal(writeStructureDragRecords(writtenRecords, [
  { path: "ketcher-sketch.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" },
]), true);
assert.equal(writtenRecords.effectAllowed, "copy");
assert.deepEqual(readStructureDragPayload(writtenRecords), {
  paths: [],
  records: [{ path: "ketcher-sketch.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$" }],
});
assert.equal(writtenRecords.getData("text/plain"), "mol\nM  END\n$$$$\n");

const files = new FakeDataTransfer({ files: [file("/tmp/ligand.sdf"), file(""), file("/tmp/receptor.pdb")] });
assert.equal(hasStructureDrag(files), true);
assert.deepEqual(readStructureDragPayload(files).paths, ["/tmp/ligand.sdf", "/tmp/receptor.pdb"]);

const pathText = new FakeDataTransfer();
pathText.setData("text/plain", "/tmp/a.sdf\n/tmp/My Ligand.sdf\nrelative.xyz\nnotes.txt\n../b.cif\n");
assert.equal(hasStructureDrag(pathText), true);
assert.deepEqual(readStructureDragPayload(pathText).paths, ["/tmp/a.sdf", "/tmp/My Ligand.sdf", "relative.xyz", "../b.cif"]);
assert.deepEqual(structureDragPayloadFromText("/tmp/a.sdf\n/tmp/My Ligand.sdf\nrelative.xyz\nnotes.txt\n../b.cif\n").paths, [
  "/tmp/a.sdf",
  "/tmp/My Ligand.sdf",
  "relative.xyz",
  "../b.cif",
]);

const fileUrlText = new FakeDataTransfer();
fileUrlText.setData("text/plain", "file:///tmp/My%20Ligand.sdf\nfile://localhost/tmp/second.sdf\nfile://server/share/remote.sdf\n");
assert.deepEqual(readStructureDragPayload(fileUrlText).paths, ["/tmp/My Ligand.sdf", "/tmp/second.sdf"]);

const malformedExplicit = new FakeDataTransfer({ files: [file("/tmp/fallback.sdf")] });
malformedExplicit.setData(STRUCTURE_DRAG_MIME, "{not-json");
assert.deepEqual(readStructureDragPayload(malformedExplicit), { paths: ["/tmp/fallback.sdf"], records: [] });

const inlineMol = new FakeDataTransfer();
inlineMol.setData("text/plain", "Example\n  Burette\n\nM  END\n$$$$\n");
const inlinePayload = readStructureDragPayload(inlineMol);
assert.equal(hasStructureDrag(inlineMol), true);
assert.deepEqual(inlinePayload.paths, []);
assert.deepEqual(inlinePayload.records, [{
  path: "structure.sdf",
  inputExtension: "sdf",
  text: "Example\n  Burette\n\nM  END\n$$$$",
}]);
assert.deepEqual(structureDragPayloadFromText("Example\n  Burette\n\nM  END\n$$$$\n"), {
  paths: [],
  records: [{
    path: "structure.sdf",
    inputExtension: "sdf",
    text: "Example\n  Burette\n\nM  END\n$$$$",
  }],
});
assert.deepEqual(structureDragRecordsToFragments(inlinePayload.records), [{
  title: "structure.sdf",
  text: "Example\n  Burette\n\nM  END\n",
}]);

const smilesText = new FakeDataTransfer();
smilesText.setData("text/plain", "CCO ethanol");
assert.equal(hasStructureDrag(smilesText), true);
assert.deepEqual(readStructureDragPayload(smilesText), {
  paths: [],
  records: [{ path: "structure.smi", inputExtension: "smi", text: "CCO ethanol" }],
});

const pdbText = new FakeDataTransfer();
pdbText.setData("text/plain", "HEADER    TEST\nATOM      1  N   GLY A   1      11.104  13.207   2.100\nEND\n");
assert.equal(hasStructureDrag(pdbText), true);
assert.deepEqual(readStructureDragPayload(pdbText).records, [{
  path: "structure.pdb",
  inputExtension: "pdb",
  text: "HEADER    TEST\nATOM      1  N   GLY A   1      11.104  13.207   2.100\nEND",
}]);

const cifText = new FakeDataTransfer();
cifText.setData("text/plain", "data_demo\n_atom_site.Cartn_x 0.0\n");
assert.equal(hasStructureDrag(cifText), true);
assert.deepEqual(readStructureDragPayload(cifText).records, [{
  path: "structure.cif",
  inputExtension: "cif",
  text: "data_demo\n_atom_site.Cartn_x 0.0",
}]);

const xyzText = new FakeDataTransfer();
xyzText.setData("text/plain", "2\nwater\nO 0.0 0.0 0.0\nH 0.0 0.0 1.0\n");
assert.equal(hasStructureDrag(xyzText), true);
assert.deepEqual(readStructureDragPayload(xyzText).records, [{
  path: "structure.xyz",
  inputExtension: "xyz",
  text: "2\nwater\nO 0.0 0.0 0.0\nH 0.0 0.0 1.0",
}]);

const unsupportedText = new FakeDataTransfer();
unsupportedText.setData("text/plain", "This is a plain note, not a molecule.");
assert.equal(hasStructureDrag(unsupportedText), false);
assert.deepEqual(readStructureDragPayload(unsupportedText), { paths: [], records: [] });

const browserFiles = await structureDragPayloadFromBrowserFiles([
  { name: "multi.sdf", size: 24, text: async () => "First\nM  END\n$$$$\nSecond\nM  END\n$$$$\n" },
  { name: "notes.txt", size: 5, text: async () => "notes" },
  { name: "empty.pdb", size: 0, text: async () => "" },
]);
assert.deepEqual(browserFiles.payload, {
  paths: [],
  records: [{
    path: "multi.sdf",
    inputExtension: "sdf",
    text: "First\nM  END\n$$$$\nSecond\nM  END\n$$$$\n",
  }],
});
assert.equal(browserFiles.errors.length, 2);

console.log("structure drag tests passed");
