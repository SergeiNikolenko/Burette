import type { DockingDocumentRequest } from "../types";

export function extensionForDocking(path: string) {
  const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  if (name.endsWith(".mae.gz")) return "maegz";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1) : "";
}

export function isProteinLikeDockingSource(path: string) {
  return ["bcif", "cif", "cms", "ent", "mae", "maegz", "mcif", "mmcif", "pdb", "pdbqt", "pqr"].includes(extensionForDocking(path));
}

function uniqueDockingPaths(paths: string[]) {
  return Array.from(new Set(paths.filter((path) => path && path.trim().length > 0)));
}

function ligandLikeDockingPaths(paths: string[]) {
  return uniqueDockingPaths(paths).filter((path) => !isProteinLikeDockingSource(path));
}

export function ligandDropPathsForTarget(targetPath: string, droppedPaths: string[]) {
  return uniqueDockingPaths(droppedPaths).filter((path) => path !== targetPath);
}

export function dockingRequestForDrop(
  targetPath: string,
  droppedPaths: string[],
  existingDockingRequest?: DockingDocumentRequest | null,
): DockingDocumentRequest | null {
  if (existingDockingRequest) {
    const existingLigands = new Set(existingDockingRequest.ligandPaths);
    const addedLigands = ligandLikeDockingPaths(droppedPaths)
      .filter((path) => path !== existingDockingRequest.receptorPath && !existingLigands.has(path));
    if (addedLigands.length === 0) return null;
    return {
      receptorPath: existingDockingRequest.receptorPath,
      ligandPaths: ligandLikeDockingPaths([...existingDockingRequest.ligandPaths, ...addedLigands])
        .filter((path) => path !== existingDockingRequest.receptorPath),
    };
  }
  const paths = uniqueDockingPaths([targetPath, ...droppedPaths]);
  const receptorPath = isProteinLikeDockingSource(targetPath) ? targetPath : paths.find(isProteinLikeDockingSource);
  if (!receptorPath) return null;
  return {
    receptorPath,
    ligandPaths: ligandLikeDockingPaths(paths.filter((path) => path !== receptorPath)),
  };
}
