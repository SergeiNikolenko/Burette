import type { ViewerDocument } from "../types";

export type StructureBriefRow = {
  label: string;
  value: string;
};

export type StructureBriefModel = {
  format: string;
  renderer: string;
  kind: string;
  badges: string[];
  summary: string;
  overviewRows: StructureBriefRow[];
  usefulRows: StructureBriefRow[];
  notes: string[];
};

export function structureBriefForDocument(document: ViewerDocument, sizeLabel: string): StructureBriefModel {
  const format = document.extension ? document.extension.toUpperCase() : "FILE";
  const renderer = rendererLabel(document.renderer);
  const kind = documentKind(document);
  const badges = [
    kind,
    renderer,
    format,
    document.virtual ? "Virtual" : "File",
  ];
  return {
    format,
    renderer,
    kind,
    badges,
    summary: `${kind} / ${renderer} / ${format} / ${sizeLabel}`,
    overviewRows: [
      { label: "Format", value: format },
      { label: "Renderer", value: renderer },
      { label: "Size", value: sizeLabel },
      { label: "Source", value: document.virtual ? "Virtual document" : "Local file" },
    ],
    usefulRows: usefulElements(document),
    notes: structureNotes(document),
  };
}

export function documentKind(document: ViewerDocument) {
  if (document.dockingRequest) return "Docking view";
  if (document.mergedCollection) return "Merged collection";
  const extension = normalizedExtension(document);
  if (["sdf", "mol", "mol2", "smiles", "smi"].includes(extension)) return "Small molecule";
  if (["csv", "tsv"].includes(extension)) return "Molecule collection";
  if (["xyz", "extxyz", "dtr", "xtc", "trr"].includes(extension)) return "Structure frames";
  if (["cube", "cub"].includes(extension)) return "Volume data";
  if (isMaestroExtension(extension)) return "Maestro structure";
  if (["pdb", "pdbqt", "cif", "mmcif", "bcif", "gro", "mae", "maegz", "cms"].includes(extension)) return "Macromolecule";
  return "Molecular file";
}

export function rendererLabel(renderer: string) {
  if (renderer === "molstar") return "Mol*";
  if (renderer === "grid2d") return "Grid";
  if (renderer === "xyzrender-external") return "xyzrender";
  return renderer || "Preview";
}

export function usefulElements(document: ViewerDocument): StructureBriefRow[] {
  if (document.dockingRequest) {
    return [
      { label: "Receptor", value: fileName(document.dockingRequest.receptorPath) },
      { label: "Ligands", value: String(document.dockingRequest.ligandPaths.length) },
      {
        label: "Active pose",
        value: document.dockingRequest.activePose == null ? "Default" : String(document.dockingRequest.activePose + 1),
      },
    ];
  }
  if (document.mergedCollection) {
    return [
      { label: "Collection format", value: document.mergedCollection.format.toUpperCase() },
      { label: "Sources", value: String(document.mergedCollection.sourcePaths.length) },
      { label: "Suggested name", value: document.mergedCollection.suggestedFileName },
    ];
  }
  const extension = normalizedExtension(document);
  if (["csv", "tsv"].includes(extension)) {
    return [
      { label: "Table", value: "Rows and columns available in grid" },
      { label: "Properties", value: "From source columns" },
      { label: "Index", value: "Managed by grid runtime" },
    ];
  }
  if (["sdf", "mol", "mol2", "smiles", "smi"].includes(extension)) {
    return [
      { label: "Molecule data", value: "Atoms and bonds in source file" },
      { label: "Properties", value: extension === "sdf" ? "SDF fields when present" : "File metadata" },
      { label: "Chem editor", value: "Open with Ketcher from file actions" },
    ];
  }
  if (["xyz", "extxyz", "dtr", "xtc", "trr"].includes(extension)) {
    return [
      { label: "Frames", value: "Preview runtime controlled" },
      { label: "Elements", value: "Available after parser summary" },
      { label: "Cell", value: "Shown by renderer when present" },
    ];
  }
  if (["cube", "cub"].includes(extension)) {
    return [
      { label: "Atoms", value: "Embedded in volume file" },
      { label: "Grid", value: "Volumetric field" },
      { label: "Iso surface", value: "Renderer controlled" },
    ];
  }
  if (isMaestroExtension(extension)) {
    return [
      { label: "Maestro source", value: "CT blocks with atom-table coordinates" },
      { label: "Preview model", value: "Coordinates extracted for Mol* rendering" },
      { label: "System parts", value: "Solute, solvent, ions, and full-system CTs when present" },
      {
        label: "Text",
        value: extension === "maegz" ? "Decompressed Maestro text opens in Text tab" : "Maestro source opens in Text tab",
      },
    ];
  }
  if (["pdb", "pdbqt", "cif", "mmcif", "bcif", "gro", "mae", "maegz", "cms"].includes(extension)) {
    return [
      { label: "Structure", value: "Shown in preview runtime" },
      { label: "Components", value: "Polymers, ligands, water, and ions when parsed" },
      { label: "Text", value: "Source tab keeps coordinate records inspectable" },
    ];
  }
  return [
    { label: "Structure", value: "Shown in preview runtime" },
    { label: "Path", value: document.path },
    { label: "Metadata", value: "Available from file actions" },
  ];
}

function structureNotes(document: ViewerDocument) {
  const notes: string[] = [];
  if (document.virtual) notes.push("This document is generated in the app");
  if (document.dockingRequest) notes.push("Docking metadata is available from runtime config");
  if (document.mergedCollection) notes.push("Merged collection keeps source path references");
  if (isMaestroExtension(normalizedExtension(document))) notes.push("Maestro CT sections are available from the source text");
  return notes;
}

function normalizedExtension(document: ViewerDocument) {
  return document.extension.toLowerCase();
}

function isMaestroExtension(extension: string) {
  return extension === "mae" || extension === "maegz" || extension === "cms";
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
