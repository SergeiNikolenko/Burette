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
  {
    id: "open-text-files",
    label: "Open as text file",
    confidence: "alternative",
    action: {
      kind: "open-text-files",
      paths: ["/tmp/a.sdf"],
    },
  },
]);
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/a.sdf"]), { kind: "ketcher" }, { kind: "tab" }).map((choice) => choice.source), [
  { kind: "tab" },
  { kind: "tab" },
  { kind: "tab" },
]);

assert.deepEqual(resolveDropActionChoices(payload(["/tmp/receptor.pdb"]), { kind: "ketcher" }), [{
  id: "open-documents",
  label: "Open as document tabs",
  confidence: "default",
  action: {
    kind: "open-documents",
    paths: ["/tmp/receptor.pdb"],
  },
}]);
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/receptor.pdb", "/tmp/a.sdf"]), { kind: "ketcher" }), [
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
      paths: ["/tmp/receptor.pdb", "/tmp/a.sdf"],
    },
  },
  {
    id: "open-text-files",
    label: "Open as text file",
    confidence: "alternative",
    action: {
      kind: "open-text-files",
      paths: ["/tmp/receptor.pdb", "/tmp/a.sdf"],
    },
  },
]);
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/receptor.pdb", "/tmp/protein.cif"]), { kind: "ketcher" }), [{
  id: "open-documents",
  label: "Open as document tabs",
  confidence: "default",
  action: {
    kind: "open-documents",
    paths: ["/tmp/receptor.pdb", "/tmp/protein.cif"],
  },
}]);

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
  {
    id: "open-text-files",
    label: "Open as text file",
    confidence: "alternative",
    action: {
      kind: "open-text-files",
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
  {
    id: "open-text-files",
    label: "Open as text file",
    confidence: "alternative",
    action: {
      kind: "open-text-files",
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
assert.deepEqual(resolveDropActionChoices(payload(["/tmp/a.sdf"]), {
  kind: "active-viewer",
  documentPath: "/tmp/grid.sdf",
  renderer: "grid2d",
}), [
  {
    id: "merge-collection",
    label: "Merge molecule collections",
    confidence: "default",
    action: {
      kind: "merge-collection",
      targetPath: "/tmp/grid.sdf",
      paths: ["/tmp/a.sdf"],
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
  {
    id: "open-text-files",
    label: "Open as text file",
    confidence: "alternative",
    action: {
      kind: "open-text-files",
      paths: ["/tmp/a.sdf"],
    },
  },
]);

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
  {
    id: "open-text-files",
    label: "Open as text file",
    confidence: "alternative",
    action: {
      kind: "open-text-files",
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
    ligandPaths: ["/tmp/old-ligand.sdf", "/tmp/new-ligand.sdf", "/tmp/receptor-2.pdb"],
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
        ligandPaths: ["/tmp/current-ligand.sdf", "/tmp/receptor-b.cif", "/tmp/ligand.sdf"],
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
        ligandPaths: ["/tmp/current-ligand.sdf", "/tmp/receptor-a.pdb", "/tmp/ligand.sdf"],
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
  {
    id: "open-text-files",
    label: "Open as text file",
    confidence: "alternative",
    action: {
      kind: "open-text-files",
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
      ligandPaths: ["/tmp/receptor-b.cif", "/tmp/ligand.sdf"],
    },
  },
});
assert.deepEqual(resolveDropAction(payload(["/tmp/receptor-b.cif"]), {
  kind: "active-viewer",
  documentPath: "/tmp/receptor-a.pdb",
  renderer: "molstar",
}), {
  kind: "open-docking",
  request: {
    receptorPath: "/tmp/receptor-a.pdb",
    ligandPaths: ["/tmp/receptor-b.cif"],
  },
});

assert.deepEqual(resolveDropActionChoices(
  payload([], [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }]),
  {
    kind: "active-viewer",
    documentPath: "/tmp/current-ligand.sdf",
    renderer: "molstar",
  },
), [
  {
    id: "open-docking-with-records",
    label: "Open docking view",
    confidence: "default",
    action: {
      kind: "open-docking-with-records",
      receptorPath: "/tmp/current-ligand.sdf",
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

const ligandOnGenericLigand = resolveDropAction(payload(["/tmp/ligand-b.sdf"]), {
  kind: "active-viewer",
  documentPath: "/tmp/ligand-a.sdf",
  renderer: "molstar",
});
assert.deepEqual(ligandOnGenericLigand, {
  kind: "open-docking",
  request: {
    receptorPath: "/tmp/ligand-a.sdf",
    ligandPaths: ["/tmp/ligand-b.sdf"],
  },
});

const trajectoryOnGro = resolveDropAction(payload(["/tmp/frame.xtc"]), {
  kind: "active-viewer",
  documentPath: "/tmp/frame.gro",
  renderer: "molstar",
});
assert.deepEqual(trajectoryOnGro, {
  kind: "open-docking",
  request: {
    receptorPath: "/tmp/frame.gro",
    ligandPaths: ["/tmp/frame.xtc"],
  },
});

const groOnTrajectory = resolveDropAction(payload(["/tmp/frame.gro"]), {
  kind: "active-viewer",
  documentPath: "/tmp/frame.xtc",
  renderer: "molstar",
});
assert.deepEqual(groOnTrajectory, {
  kind: "open-docking",
  request: {
    receptorPath: "/tmp/frame.gro",
    ligandPaths: ["/tmp/frame.xtc"],
  },
});

const netcdfTrajectoryOnReference = resolveDropAction(payload(["/tmp/trajectory.nc"]), {
  kind: "active-viewer",
  documentPath: "/tmp/reference.pdb",
  renderer: "molstar",
});
assert.deepEqual(netcdfTrajectoryOnReference, {
  kind: "open-docking",
  request: {
    receptorPath: "/tmp/reference.pdb",
    ligandPaths: ["/tmp/trajectory.nc"],
  },
});

const referenceOnNetcdfTrajectory = resolveDropAction(payload(["/tmp/reference.pdb"]), {
  kind: "active-viewer",
  documentPath: "/tmp/trajectory.nc",
  renderer: "molstar",
});
assert.deepEqual(referenceOnNetcdfTrajectory, {
  kind: "open-docking",
  request: {
    receptorPath: "/tmp/reference.pdb",
    ligandPaths: ["/tmp/trajectory.nc"],
  },
});

const dragDropMatrix = [
  {
    name: "protein target plus ligand file opens docking view",
    actual: resolveDropAction(payload(["/tmp/ligand.sdf"]), {
      kind: "active-viewer",
      documentPath: "/tmp/receptor.pdb",
      renderer: "molstar",
    }),
    expected: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/receptor.pdb",
        ligandPaths: ["/tmp/ligand.sdf"],
      },
    },
  },
  {
    name: "protein target plus inline ligand record opens docking view",
    actual: resolveDropAction(payload([], [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }]), {
      kind: "active-viewer",
      documentPath: "/tmp/receptor.pdb",
      renderer: "molstar",
    }),
    expected: {
      kind: "open-docking-with-records",
      receptorPath: "/tmp/receptor.pdb",
      ligandPaths: [],
      records: [{ path: "grid-ligand.sdf", inputExtension: "sdf", text: "mol\nM  END\n$$$$\n" }],
    },
  },
  {
    name: "protein target plus protein file opens combined view",
    actual: resolveDropAction(payload(["/tmp/receptor-b.cif"]), {
      kind: "active-viewer",
      documentPath: "/tmp/receptor-a.pdb",
      renderer: "molstar",
    }),
    expected: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/receptor-a.pdb",
        ligandPaths: ["/tmp/receptor-b.cif"],
      },
    },
  },
  {
    name: "ligand target plus ligand file opens combined view",
    actual: resolveDropAction(payload(["/tmp/ligand-b.sdf"]), {
      kind: "active-viewer",
      documentPath: "/tmp/ligand-a.sdf",
      renderer: "molstar",
    }),
    expected: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/ligand-a.sdf",
        ligandPaths: ["/tmp/ligand-b.sdf"],
      },
    },
  },
  {
    name: "gro target plus trajectory file opens combined view",
    actual: resolveDropAction(payload(["/tmp/frame.xtc"]), {
      kind: "active-viewer",
      documentPath: "/tmp/frame.gro",
      renderer: "molstar",
    }),
    expected: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/frame.gro",
        ligandPaths: ["/tmp/frame.xtc"],
      },
    },
  },
  {
    name: "trajectory target plus gro file opens combined view with gro anchor",
    actual: resolveDropAction(payload(["/tmp/frame.gro"]), {
      kind: "active-viewer",
      documentPath: "/tmp/frame.xtc",
      renderer: "molstar",
    }),
    expected: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/frame.gro",
        ligandPaths: ["/tmp/frame.xtc"],
      },
    },
  },
  {
    name: "structure target plus NetCDF trajectory opens combined view",
    actual: resolveDropAction(payload(["/tmp/trajectory.nc"]), {
      kind: "active-viewer",
      documentPath: "/tmp/reference.pdb",
      renderer: "molstar",
    }),
    expected: {
      kind: "open-docking",
      request: {
        receptorPath: "/tmp/reference.pdb",
        ligandPaths: ["/tmp/trajectory.nc"],
      },
    },
  },
  {
    name: "grid collection target with document id appends records",
    actual: resolveDropAction(payload(["/tmp/collection-b.sdf"]), {
      kind: "active-viewer",
      documentId: "grid-doc",
      documentPath: "/tmp/collection-a.sdf",
      renderer: "grid2d",
    }),
    expected: {
      kind: "append-grid-records",
      targetDocumentId: "grid-doc",
      payload: payload(["/tmp/collection-b.sdf"]),
    },
  },
  {
    name: "grid collection target without document id merges collections",
    actual: resolveDropAction(payload(["/tmp/collection-b.sdf"]), {
      kind: "active-viewer",
      documentPath: "/tmp/collection-a.sdf",
      renderer: "grid2d",
    }),
    expected: {
      kind: "merge-collection",
      targetPath: "/tmp/collection-a.sdf",
      paths: ["/tmp/collection-b.sdf"],
    },
  },
  {
    name: "xyzrender target adds sheet items",
    actual: resolveDropAction(payload(["/tmp/ligand.xyz"]), {
      kind: "active-viewer",
      documentPath: "/tmp/sheet.xyz",
      renderer: "xyzrender-external",
    }),
    expected: {
      kind: "add-xyzrender-sheet-items",
      targetDocumentId: undefined,
      payload: payload(["/tmp/ligand.xyz"]),
    },
  },
  {
    name: "ketcher target imports only supported ligand formats from mixed drop",
    actual: resolveDropAction(payload(["/tmp/receptor.pdb", "/tmp/ligand.sdf"]), { kind: "ketcher" }),
    expected: {
      kind: "import-ketcher-structures",
      payload: payload(["/tmp/ligand.sdf"]),
    },
  },
  {
    name: "ketcher target opens protein-only drops separately",
    actual: resolveDropAction(payload(["/tmp/receptor.pdb", "/tmp/protein.cif"]), { kind: "ketcher" }),
    expected: {
      kind: "open-documents",
      paths: ["/tmp/receptor.pdb", "/tmp/protein.cif"],
    },
  },
];

for (const testCase of dragDropMatrix) {
  assert.deepEqual(testCase.actual, testCase.expected, testCase.name);
}

assert.equal(resolveDropAction(payload([]), { kind: "workspace" }), null);
assert.deepEqual(resolveDropActionChoices(payload([]), { kind: "workspace" }), []);

console.log("drop action tests passed");
