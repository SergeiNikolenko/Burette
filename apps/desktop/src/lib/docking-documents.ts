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

export function dockingRequestForDrop(
  targetPath: string,
  droppedPaths: string[],
  existingDockingRequest?: DockingDocumentRequest | null,
): DockingDocumentRequest {
  if (existingDockingRequest) {
    return {
      receptorPath: existingDockingRequest.receptorPath,
      ligandPaths: uniqueDockingPaths([...existingDockingRequest.ligandPaths, ...droppedPaths])
        .filter((path) => path && path !== existingDockingRequest.receptorPath),
    };
  }
  const paths = uniqueDockingPaths([targetPath, ...droppedPaths]);
  const receptorPath = isProteinLikeDockingSource(targetPath)
    ? targetPath
    : paths.find(isProteinLikeDockingSource) ?? targetPath;
  return {
    receptorPath,
    ligandPaths: paths.filter((path) => path !== receptorPath),
  };
}
