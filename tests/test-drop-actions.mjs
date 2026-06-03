#!/usr/bin/env node
import assert from "node:assert/strict";

const { resolveDropAction, resolveDropActionChoices } = await import("../apps/desktop/src/lib/drop-actions.ts");

function payload(paths, records = []) {
  return { paths, records };
}

const sdfOnWorkspace = resolveDropAction(payload(["/tmp/a.sdf"]), { kind: "workspace" });
assert.deepEqual(sdfOnWorkspace, {
  kind: "open-documents",
  paths: ["/tmp/a.sdf"],
});
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/a.sdf"]), { kind: "workspace" }), [{
  id: "open-documents",
  label: "Open as document tabs",
  confidence: "default",
  action: {
    kind: "open-documents",
    paths: ["/tmp/a.sdf"],
  },
}]);
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/a.sdf"]), { kind: "workspace" }, { kind: "clipboard" }), [{
  id: "open-documents",
  label: "Open as document tabs",
  confidence: "default",
  source: { kind: "clipboard" },
  action: {
    kind: "open-documents",
    paths: ["/tmp/a.sdf"],
  },
}]);

const inlineOnWorkspace = resolveDropAction(
  payload([], [{ path: "structure.sdf", inputExtension: "sdf", text: "mol\nM  END\n" }]),
  { kind: "workspace" },
);
assert.deepEqual(inlineOnWorkspace, {
  kind: "open-structure-records",
  paths: [],
  records: [{ path: "structure.sdf", inputExtension: "sdf", text: "mol\nM  END\n" }],
});
assert.deepEqual(
  resolveDropActionChoices(
    payload([], [{ path: "structure.sdf", inputExtension: "sdf", text: "mol\nM  END\n" }]),
    { kind: "workspace" },
  ),
  [{
    id: "open-structure-records",
    label: "Open as document tabs",
    confidence: "default",
    action: {
      kind: "open-structure-records",
      paths: [],
      records: [{ path: "structure.sdf", inputExtension: "sdf", text: "mol\nM  END\n" }],
    },
  }],
);

const sdfOnKetcher = resolveDropAction(payload(["/tmp/a.sdf"]), { kind: "ketcher" });
assert.deepEqual(sdfOnKetcher, {
  kind: "import-ketcher-structures",
  payload: payload(["/tmp/a.sdf"]),
});
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/a.sdf"]), { kind: "ketcher" }), [
  {
    id: "import-ketcher-structures",
    label: "Add to Ketcher",
    confidence: "default",
    action: {
      kind: "import-ketcher-structures",
      payload: payload(["/tmp/a.sdf"]),
    },
  },
  {
    id: "open-documents",
    label: "Open separately",
    confidence: "alternative",
    action: {
      kind: "open-documents",
      paths: ["/tmp/a.sdf"],
    },
  },
]);
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/a.sdf"]), { kind: "ketcher" }, { kind: "tab" }).map((choice) => choice.source), [
  { kind: "tab" },
  { kind: "tab" },
]);

const inlineOnKetcher = resolveDropAction(
  payload([], [{ path: "structure.smi", inputExtension: "smi", text: "CCO\n" }]),
  { kind: "ketcher" },
);
assert.deepEqual(inlineOnKetcher, {
  kind: "import-ketcher-structures",
  payload: payload([], [{ path: "structure.smi", inputExtension: "smi", text: "CCO\n" }]),
});

const fepSetupRequest = {
  receptorPath: "/tmp/receptor.pdb",
  gridDocumentId: "grid-doc",
  gridPath: "/tmp/poses.sdf",
  dockingDocumentId: "docking-doc",
  dockingPath: "burrete-docking://poses",
  referencePose: 2,
};
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/analogs.sdf"]), {
  kind: "fep-setup",
  request: fepSetupRequest,
}), [
  {
    id: "prepare-fep-setup",
    label: "Open FEP setup",
    confidence: "default",
    action: {
      kind: "prepare-fep-setup",
      request: {
        ...fepSetupRequest,
        candidatePayload: payload(["/tmp/analogs.sdf"]),
      },
    },
  },
  {
    id: "open-documents",
    label: "Open separately",
    confidence: "alternative",
    action: {
      kind: "open-documents",
      paths: ["/tmp/analogs.sdf"],
    },
  },
]);

assert.deepEqual(resolveDropAction(payload(["/tmp/a.pdb"], [{ path: "structure.smi", inputExtension: "smi", text: "CCO\n" }]), {
  kind: "workspace",
}), {
  kind: "open-structure-records",
  paths: ["/tmp/a.pdb"],
  records: [{ path: "structure.smi", inputExtension: "smi", text: "CCO\n" }],
});

const collectionOnGrid = resolveDropAction(payload(["/tmp/a.sdf"]), {
  kind: "active-viewer",
  documentId: "grid-doc",
  documentPath: "/tmp/grid.sdf",
  renderer: "grid2d",
});
assert.deepEqual(collectionOnGrid, {
  kind: "append-grid-records",
  targetDocumentId: "grid-doc",
  payload: payload(["/tmp/a.sdf"]),
});
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/a.sdf"]), {
  kind: "active-viewer",
  documentId: "grid-doc",
  documentPath: "/tmp/grid.sdf",
  renderer: "grid2d",
}), [
  {
    id: "append-grid-records",
    label: "Append to grid",
    confidence: "default",
    action: {
      kind: "append-grid-records",
      targetDocumentId: "grid-doc",
      payload: payload(["/tmp/a.sdf"]),
    },
  },
  {
    id: "open-documents",
    label: "Open separately",
    confidence: "alternative",
    action: {
      kind: "open-documents",
      paths: ["/tmp/a.sdf"],
    },
  },
]);

assert.deepEqual(resolveDropAction(payload(["/tmp/a.sdf"]), {
  kind: "active-viewer",
  documentPath: "/tmp/grid.sdf",
  renderer: "grid2d",
}), {
  kind: "merge-collection",
  targetPath: "/tmp/grid.sdf",
  paths: ["/tmp/a.sdf"],
});

const structureOnXyzrender = resolveDropAction(payload(["/tmp/a.xyz"]), {
  kind: "active-viewer",
  documentPath: "/tmp/sheet.xyz",
  renderer: "xyzrender-external",
});
assert.equal(structureOnXyzrender?.kind, "add-xyzrender-sheet-items");
assert.deepEqual(structureOnXyzrender?.payload, payload(["/tmp/a.xyz"]));

const inlineOnXyzrender = resolveDropAction(
  payload([], [{ path: "structure.sdf", inputExtension: "sdf", text: "mol\nM  END\n" }]),
  {
    kind: "active-viewer",
    documentPath: "/tmp/sheet.xyz",
    renderer: "xyzrender-external",
  },
);
assert.equal(inlineOnXyzrender?.kind, "add-xyzrender-sheet-items");
assert.equal(resolveDropActionChoices(
  payload([], [{ path: "structure.sdf", inputExtension: "sdf", text: "mol\nM  END\n" }]),
  {
    kind: "active-viewer",
    documentPath: "/tmp/sheet.xyz",
    renderer: "xyzrender-external",
  },
).length, 2);

const ligandOnProtein = resolveDropAction(payload(["/tmp/ligand.sdf"]), {
  kind: "active-viewer",
  documentPath: "/tmp/receptor.pdb",
  renderer: "molstar",
});
assert.deepEqual(ligandOnProtein, {
  kind: "open-docking",
  request: {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/ligand.sdf"],
  },
});
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/ligand.sdf"]), {
  kind: "active-viewer",
  documentPath: "/tmp/receptor.pdb",
  renderer: "molstar",
}), [
  {
    id: "open-docking",
    label: "Open docking view",
    confidence: "default",
    action: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/receptor.pdb",
        ligandPaths: ["/tmp/ligand.sdf"],
      },
    },
  },
  {
    id: "open-documents",
    label: "Open separately",
    confidence: "alternative",
    action: {
      kind: "open-documents",
      paths: ["/tmp/ligand.sdf"],
    },
  },
]);

assert.deepEqual(resolveDropActionChoices(
  payload([], [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }]),
  {
    kind: "active-viewer",
    documentPath: "/tmp/receptor.pdb",
    renderer: "molstar",
  },
), [
  {
    id: "open-docking-with-records",
    label: "Open docking view",
    confidence: "default",
    action: {
      kind: "open-docking-with-records",
      receptorPath: "/tmp/receptor.pdb",
      ligandPaths: [],
      records: [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }],
    },
  },
  {
    id: "open-structure-records",
    label: "Open separately",
    confidence: "alternative",
    action: {
      kind: "open-structure-records",
      paths: [],
      records: [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }],
    },
  },
]);
assert.deepEqual(
  resolveDropActionChoices(
    payload([], [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }]),
    {
      kind: "active-viewer",
      documentPath: "/tmp/receptor.pdb",
      renderer: "molstar",
    },
    { kind: "clipboard" },
  ).map((choice) => choice.source),
  [{ kind: "clipboard" }, { kind: "clipboard" }],
);

const ligandOnDocking = resolveDropAction(payload(["/tmp/new-ligand.sdf", "/tmp/receptor-2.pdb"]), {
  kind: "active-viewer",
  documentPath: "burrete-docking://active",
  renderer: "molstar",
  dockingRequest: {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/old-ligand.sdf"],
  },
});
assert.deepEqual(ligandOnDocking, {
  kind: "open-docking",
  request: {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/old-ligand.sdf", "/tmp/new-ligand.sdf"],
  },
});

assert.deepEqual(resolveDropAction(payload([], [{ path: "new-grid-ligand.smi", inputExtension: "smi", text: "CCO ethanol\n" }]), {
  kind: "active-viewer",
  documentPath: "burrete-docking://active",
  renderer: "molstar",
  dockingRequest: {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/old-ligand.sdf"],
  },
}), {
  kind: "open-docking-with-records",
  receptorPath: "/tmp/receptor.pdb",
  ligandPaths: ["/tmp/old-ligand.sdf"],
  records: [{ path: "new-grid-ligand.smi", inputExtension: "smi", text: "CCO ethanol\n" }],
});

assert.deepEqual(resolveDropActionChoices(payload(["/tmp/receptor-a.pdb", "/tmp/receptor-b.cif", "/tmp/ligand.sdf"]), {
  kind: "active-viewer",
  documentPath: "/tmp/current-ligand.sdf",
  renderer: "molstar",
}), [
  {
    id: "open-docking-0",
    label: "Dock with receptor-a.pdb",
    confidence: "default",
    action: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/receptor-a.pdb",
        ligandPaths: ["/tmp/current-ligand.sdf", "/tmp/ligand.sdf"],
      },
    },
  },
  {
    id: "open-docking-1",
    label: "Dock with receptor-b.cif",
    confidence: "alternative",
    action: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/receptor-b.cif",
        ligandPaths: ["/tmp/current-ligand.sdf", "/tmp/ligand.sdf"],
      },
    },
  },
  {
    id: "open-documents",
    label: "Open separately",
    confidence: "alternative",
    action: {
      kind: "open-documents",
      paths: ["/tmp/receptor-a.pdb", "/tmp/receptor-b.cif", "/tmp/ligand.sdf"],
    },
  },
]);

assert.deepEqual(resolveDropActionChoices(payload(["/tmp/receptor-b.cif", "/tmp/ligand.sdf"]), {
  kind: "active-viewer",
  documentPath: "/tmp/receptor-a.pdb",
  renderer: "molstar",
})[0], {
  id: "open-docking-0",
  label: "Dock with receptor-a.pdb",
  confidence: "default",
  action: {
    kind: "open-docking",
    request: {
      receptorPath: "/tmp/receptor-a.pdb",
      ligandPaths: ["/tmp/ligand.sdf"],
    },
  },
});

assert.deepEqual(resolveDropActionChoices(
  payload([], [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }]),
  {
    kind: "active-viewer",
    documentPath: "/tmp/current-ligand.sdf",
    renderer: "molstar",
  },
), [{
  id: "open-structure-records",
  label: "Open as document tabs",
  confidence: "default",
  action: {
    kind: "open-structure-records",
    paths: [],
    records: [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }],
  },
}]);

const ligandOnGenericLigand = resolveDropAction(payload(["/tmp/ligand-b.sdf"]), {
  kind: "active-viewer",
  documentPath: "/tmp/ligand-a.sdf",
  renderer: "molstar",
});
assert.deepEqual(ligandOnGenericLigand, {
  kind: "open-documents",
  paths: ["/tmp/ligand-b.sdf"],
});

assert.equal(resolveDropAction(payload([]), { kind: "workspace" }), null);
assert.deepEqual(resolveDropActionChoices(payload([]), { kind: "workspace" }), []);

console.log("drop action tests passed");
