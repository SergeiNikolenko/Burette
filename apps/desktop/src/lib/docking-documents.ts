import type { DockingDocumentRequest } from "../types";
import previewFormatRegistry from "../../../../config/preview-formats.json";

export type DockingDropCandidate = DockingDocumentRequest;

const MOLSTAR_COORDINATE_TRAJECTORY_EXTENSIONS = new Set([
  "xtc",
  "trr",
  "dcd",
  "nctraj",
  "nc",
  "ncdf",
  "netcdf",
  "ncrst",
  "lammpstrj",
]);
const MOLSTAR_TRAJECTORY_EXTENSIONS = new Set([...MOLSTAR_COORDINATE_TRAJECTORY_EXTENSIONS, "top", "psf", "prmtop"]);
const MOLSTAR_DIRECT_VIEWER_EXTENSIONS = new Set(
  previewFormatRegistry.formats
    .filter((format) => Boolean(format.viewer) && format.viewer?.externalOnly !== true)
    .flatMap((format) => format.extensions.map((extension) => extension === "mae.gz" ? "maegz" : extension)),
);
const MOLSTAR_COMBINE_EXTENSIONS = new Set([
  ...previewFormatRegistry.formats
    .filter((format) => Boolean(format.viewer))
    .flatMap((format) => format.extensions.map((extension) => extension === "mae.gz" ? "maegz" : extension)),
  ...MOLSTAR_TRAJECTORY_EXTENSIONS,
]);

export function extensionForDocking(path: string) {
  const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  if (name.endsWith(".mae.gz")) return "maegz";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1) : "";
}

export function isProteinLikeDockingSource(path: string) {
  return ["bcif", "cif", "cms", "ent", "mae", "maegz", "mcif", "mmcif", "pdb", "pdbqt", "pqr"].includes(extensionForDocking(path));
}

export function isMolstarCombineSource(path: string) {
  return MOLSTAR_COMBINE_EXTENSIONS.has(extensionForDocking(path));
}

export function isMolstarViewerExtension(extension: string) {
  return MOLSTAR_DIRECT_VIEWER_EXTENSIONS.has(extension.trim().replace(/^\./u, "").toLowerCase());
}

export function isMolstarCoordinateTrajectorySource(path: string) {
  return MOLSTAR_COORDINATE_TRAJECTORY_EXTENSIONS.has(extensionForDocking(path));
}

function uniqueDockingPaths(paths: string[]) {
  return Array.from(new Set(paths.filter((path) => path && path.trim().length > 0)));
}

function combineDockingPaths(paths: string[]) {
  return uniqueDockingPaths(paths).filter(isMolstarCombineSource);
}

export function ligandDropPathsForTarget(targetPath: string, droppedPaths: string[]) {
  return uniqueDockingPaths(droppedPaths).filter((path) => path !== targetPath);
}

export function dockingRequestForDrop(
  targetPath: string,
  droppedPaths: string[],
  existingDockingRequest?: DockingDocumentRequest | null,
): DockingDocumentRequest | null {
  return dockingCandidatesForDrop(targetPath, droppedPaths, existingDockingRequest)[0] ?? null;
}

export function dockingCandidatesForDrop(
  targetPath: string,
  droppedPaths: string[],
  existingDockingRequest?: DockingDocumentRequest | null,
): DockingDropCandidate[] {
  if (existingDockingRequest) {
    const existingLigands = new Set(existingDockingRequest.ligandPaths);
    const addedLigands = combineDockingPaths(droppedPaths)
      .filter((path) => path !== existingDockingRequest.receptorPath && !existingLigands.has(path));
    if (addedLigands.length === 0) return [];
    return [{
      receptorPath: existingDockingRequest.receptorPath,
      ligandPaths: combineDockingPaths([...existingDockingRequest.ligandPaths, ...addedLigands])
        .filter((path) => path !== existingDockingRequest.receptorPath),
    }];
  }
  const paths = combineDockingPaths([targetPath, ...droppedPaths]);
  const receptorPaths = paths.filter(isProteinLikeDockingSource);
  const modelOrTopologyPaths = paths.filter((path) => !isMolstarCoordinateTrajectorySource(path));
  const anchorPaths = receptorPaths.length > 0
    ? receptorPaths
    : (modelOrTopologyPaths.length > 0 ? modelOrTopologyPaths : paths);
  return anchorPaths
    .map((receptorPath) => ({
      receptorPath,
      ligandPaths: paths.filter((path) => path !== receptorPath),
    }))
    .filter((candidate) => candidate.ligandPaths.length > 0);
}
