import previewFormatRegistry from "../../../../config/preview-formats.json";
import { basename } from "./sidebar-projects";

export const NOT_RENDERABLE_RENDERER = "not-renderable";

export const structureExtensions = new Set(previewFormatRegistry.formats
  .filter((format) => format.preview?.strategy !== "text")
  .flatMap((format) => format.extensions)
  .map((extension) => extension.toLowerCase()));

export const preferredTextExtensions = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "log",
  "out",
  "err",
  "sh",
  "bash",
  "zsh",
  "py",
  "rs",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "yaml",
  "yml",
  "toml",
  "html",
  "css",
  "msj",
  "dms",
  "edr",
  "fasta",
  "par",
  "prm",
  "rtf",
  "str",
  "xvg",
  "key",
  "chk",
  "checkpoint",
]);

const preferredTextBasenames = new Set([
  "log.lammps",
]);

export function isPreferredTextPath(path: string, extension = pathExtension(path)) {
  return preferredTextExtensions.has(extension) || preferredTextBasenames.has(basename(path).toLowerCase());
}

export const structureAndTextExtensions = new Set([
  "abi",
  "cfg",
  "cms",
  "com",
  "config",
  "coor",
  "csv",
  "crdbox",
  "cub",
  "cube",
  "data",
  "dcd",
  "dump",
  "edge",
  "fdf",
  "fhiaims",
  "gms",
  "graphml",
  "gsd",
  "h5md",
  "in",
  "inp",
  "inpcrd",
  "itp",
  "lammpstrj",
  "lammps",
  "lmp",
  "mae",
  "maegz",
  "mdcrd",
  "namdbin",
  "nc",
  "ncdf",
  "ncrst",
  "nctraj",
  "netcdf",
  "nw",
  "parm",
  "parm7",
  "prmtop",
  "psf",
  "pos",
  "psi4",
  "qcin",
  "crd",
  "restrt",
  "rst",
  "rst7",
  "state",
  "top",
  "tpr",
  "tng",
  "trc",
  "trr",
  "trz",
  "tsv",
  "txyz",
  "xtc",
  "vasp",
  "xml",
]);

export type GridDelimitedColumnChoice = {
  index: number;
  name: string;
};

export function structureExtensionFromPath(path: string | null | undefined) {
  const name = basename(String(path || ""));
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "pdb";
}

export function isDelimitedColumnAmbiguity(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("multiple possible structure columns");
}

export function delimitedColumnChoiceLabel(choice: GridDelimitedColumnChoice) {
  return `${choice.name} (column ${choice.index})`;
}

export function summarizeErrors(errors: string[]) {
  const [first = "Unknown error", ...rest] = errors.map(summarizeErrorText);
  return rest.length > 0
    ? `${first} (+${rest.length} more ${rest.length === 1 ? "issue" : "issues"})`
    : first;
}

export function summarizeErrorText(message: string) {
  return (message || "Unknown error").trim().split(/\r?\n| Error:| at /)[0]?.trim() || "Unknown error";
}

export function isFepGraphmlPath(path: string) {
  return /\.(?:graphml|edge)$/iu.test(path);
}

export function pathExtension(path: string) {
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  if (fileName.toLowerCase().endsWith(".mae.gz")) return "maegz";
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) return "";
  return fileName.slice(index + 1).toLowerCase();
}
