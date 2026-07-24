import type { ReactElement } from "react";
import { pathExtension } from "../../lib/file-routing";

// Sidebar rows are scanned, not read. The distinction that matters in a molecular
// workbench is the scientific role of the file (receptor, ligand, trajectory,
// spectrum...), not its extension, so extensions collapse into a small set of
// kinds and each kind gets a purpose-drawn glyph.
export type FileKind =
  | "protein"
  | "crystal"
  | "molecule"
  | "table"
  | "trajectory"
  | "topology"
  | "calculation"
  | "spectrum"
  | "network"
  | "scene"
  | "sequence"
  | "plot"
  | "log"
  | "document"
  | "code"
  | "config"
  | "default";

const FILE_KIND_BY_EXTENSION: Record<string, FileKind> = {
  // Macromolecular coordinates
  pdb: "protein",
  ent: "protein",
  pdbqt: "protein",
  pqr: "protein",
  xpdb: "protein",
  mmcif: "protein",
  mcif: "protein",
  bcif: "protein",
  mmtf: "protein",
  mae: "protein",
  maegz: "protein",

  cif: "crystal",

  // Small molecules
  sdf: "molecule",
  sd: "molecule",
  mol: "molecule",
  mdl: "molecule",
  mol2: "molecule",
  xyz: "molecule",
  txyz: "molecule",
  arc: "molecule",
  ph4: "molecule",

  // Structure collections
  smi: "table",
  smiles: "table",
  csv: "table",
  tsv: "table",
  dwar: "table",

  // Trajectories and restart frames
  xtc: "trajectory",
  trr: "trajectory",
  dcd: "trajectory",
  nctraj: "trajectory",
  tng: "trajectory",
  h5md: "trajectory",
  gsd: "trajectory",
  trz: "trajectory",
  coor: "trajectory",
  namdbin: "trajectory",
  lammpstrj: "trajectory",
  dump: "trajectory",
  pos: "trajectory",
  trj: "trajectory",
  mdcrd: "trajectory",
  crdbox: "trajectory",
  trc: "trajectory",
  history: "trajectory",
  nc: "trajectory",
  ncdf: "trajectory",
  netcdf: "trajectory",
  ncrst: "trajectory",
  inpcrd: "trajectory",
  rst7: "trajectory",
  restrt: "trajectory",
  crd: "trajectory",
  rst: "trajectory",
  state: "trajectory",

  // Topologies and prepared systems
  top: "topology",
  psf: "topology",
  prmtop: "topology",
  tpr: "topology",
  parm7: "topology",
  parm: "topology",
  itp: "topology",
  data: "topology",
  lammps: "topology",
  lmp: "topology",
  gro: "topology",
  cms: "topology",
  dms: "topology",

  // Quantum / job input decks and volumetric output
  abi: "calculation",
  com: "calculation",
  cub: "calculation",
  cube: "calculation",
  fdf: "calculation",
  fhiaims: "calculation",
  gms: "calculation",
  in: "calculation",
  inp: "calculation",
  nw: "calculation",
  psi4: "calculation",
  qcin: "calculation",
  vasp: "calculation",
  xyzr: "calculation",
  msj: "calculation",

  ms: "spectrum",
  magma: "spectrum",
  mgf: "spectrum",
  msp: "spectrum",
  mzml: "spectrum",
  mzxml: "spectrum",

  graphml: "network",
  edge: "network",

  mvsj: "scene",
  mvsx: "scene",

  fasta: "sequence",

  xvg: "plot",
  edr: "plot",

  log: "log",
  out: "log",
  err: "log",

  md: "document",
  markdown: "document",
  mdx: "document",
  txt: "document",

  py: "code",
  rs: "code",
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  html: "code",
  css: "code",

  json: "config",
  yaml: "config",
  yml: "config",
  toml: "config",
  xml: "config",
  cfg: "config",
  config: "config",
  par: "config",
  prm: "config",
  rtf: "config",
  str: "config",
  key: "config",
  chk: "config",
  checkpoint: "config",
  fdef: "config",
};

export function fileKindForPath(path: string, extension?: string): FileKind {
  const candidate = (extension || "").trim().toLowerCase() || pathExtension(path);
  // Extensions come from scanning user directories, so a file really can be named
  // "notes.constructor" or "x.__proto__". A plain lookup would hand back
  // Object.prototype's member instead of undefined, and ?? would not catch it.
  return Object.hasOwn(FILE_KIND_BY_EXTENSION, candidate)
    ? FILE_KIND_BY_EXTENSION[candidate]
    : "default";
}

export function FileKindIcon({ kind }: { kind: FileKind }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {KIND_GLYPHS[kind]}
    </svg>
  );
}

// Drawn in the SF Symbols idiom: one uniform monoline weight across the whole set,
// round terminals, generous corner radii on enclosures, and Apple's own shorthands
// where one exists for the concept — a curve between two points for a trajectory,
// a viewfinder for a saved scene, axes with a polyline for a plot, angle brackets
// for code. Fills appear only where they carry meaning, never as decoration.
const KIND_GLYPHS: Record<FileKind, ReactElement> = {
  // Helix wound as a coil. Four half-turns rather than three: at 16px three read
  // as a plain "S", and mirrored strands collapse into a closed pouch shape.
  protein: <path d="M7 20.4c0-1.95 10-1.95 10-3.9s-10-1.95-10-3.9 10-1.95 10-3.9-10-1.95-10-3.9" />,
  // Unit cell drawn as an isometric cube.
  crystal: (
    <>
      <path d="M12 3 19.9 7.4v9.2L12 21l-7.9-4.4V7.4Z" />
      <path d="M12 12 19.9 7.4M12 12 4.1 7.4M12 12v9" />
    </>
  ),
  // Aromatic ring with a substituent.
  molecule: (
    <>
      <path d="M16.8 13.7 13.7 19.1H7.5L4.4 13.7 7.5 8.3h6.2Z" />
      <circle cx="10.6" cy="13.7" r="2.5" />
      <path d="M13.7 8.3 16.9 5.7" />
      <circle cx="18.5" cy="4.5" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  // Header row and key column.
  table: (
    <>
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="4.2" />
      <path d="M3.4 10h17.2M9.7 10v9.4" />
    </>
  ),
  // A path travelled from one point to another.
  trajectory: (
    <>
      <circle cx="5" cy="18.4" r="2.2" />
      <path d="M6.7 17C7.6 12.4 11 9.3 16.9 8.3" />
      <circle cx="19" cy="6.6" r="2.7" fill="currentColor" stroke="none" />
    </>
  ),
  // Bonded atoms.
  topology: (
    <>
      <circle cx="5.2" cy="16.2" r="2.5" />
      <circle cx="12" cy="8.6" r="2.5" />
      <circle cx="18.8" cy="16.2" r="2.5" />
      <path d="M6.9 14.3 10.3 10.5M13.7 10.5 17.1 14.3" />
    </>
  ),
  // Flask.
  calculation: (
    <>
      <path d="M9.6 3.2v6.4l-4.8 8.7c-.8 1.5.3 3.3 2 3.3h10.4c1.7 0 2.8-1.8 2-3.3l-4.8-8.7V3.2" />
      <path d="M8.3 3.2h7.4M7.4 15.9h9.2" />
    </>
  ),
  // Peaks on a baseline.
  spectrum: (
    <>
      <path d="M3.6 19.6h16.8" />
      <path d="M6.8 19.6v-6.4M10.8 19.6V5.8M14.8 19.6v-4.4M18.8 19.6v-10" />
    </>
  ),
  // Closed graph, so it never reads as the open chain used for topology.
  network: (
    <>
      <circle cx="12" cy="5.4" r="2.2" />
      <circle cx="5.4" cy="17.4" r="2.2" />
      <circle cx="18.6" cy="17.4" r="2.2" />
      <path d="M10.9 7.3 6.5 15.5M13.1 7.3 17.5 15.5M7.6 17.4h8.8" />
    </>
  ),
  // Molecule framed by a viewfinder.
  scene: (
    <>
      <path d="M8.8 3.6H6.2A2.6 2.6 0 0 0 3.6 6.2v2.6" />
      <path d="M15.2 3.6h2.6a2.6 2.6 0 0 1 2.6 2.6v2.6" />
      <path d="M20.4 15.2v2.6a2.6 2.6 0 0 1-2.6 2.6h-2.6" />
      <path d="M8.8 20.4H6.2a2.6 2.6 0 0 1-2.6-2.6v-2.6" />
      <path d="M16 12 14 15.4h-4L8 12l2-3.4h4Z" />
    </>
  ),
  // Aligned residue blocks.
  sequence: (
    <>
      <path d="M3.6 7.4h4.4M10.3 7.4h2.6M15.2 7.4h5.2" />
      <path d="M3.6 12h2.4M8.3 12h5.4M16 12h4.4" />
      <path d="M3.6 16.6h5.6M11.5 16.6h2.4M16.2 16.6h4.2" />
    </>
  ),
  // Series on axes.
  plot: (
    <>
      <path d="M4.2 3.6v16.2h16.2" />
      <path d="m7 15.8 3.4-4.6 3 2.7 4.6-6.4" />
    </>
  ),
  // Console prompt.
  log: (
    <>
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="4.2" />
      <path d="m7.6 10 2.4 2-2.4 2M13 14h3.6" />
    </>
  ),
  // Page with a folded corner.
  document: (
    <>
      <path d="M13.4 3.4H7.2A2.2 2.2 0 0 0 5 5.6v12.8a2.2 2.2 0 0 0 2.2 2.2h9.6a2.2 2.2 0 0 0 2.2-2.2V9Z" />
      <path d="M13.4 3.4V9H19" />
      <path d="M8.4 13h7.2M8.4 16.4h4.6" />
    </>
  ),
  code: (
    <>
      <path d="M9.4 7.4 4.4 12l5 4.6M14.6 7.4 19.6 12l-5 4.6" />
      <path d="M12.9 5.4 11.1 18.6" />
    </>
  ),
  // Parameter sliders.
  config: (
    <>
      <path d="M4 6.8h3.4M11.4 6.8h8.6" />
      <circle cx="9.4" cy="6.8" r="2" />
      <path d="M4 12h9.6M17.6 12h2.4" />
      <circle cx="15.6" cy="12" r="2" />
      <path d="M4 17.2h5.4M13.4 17.2h6.6" />
      <circle cx="11.4" cy="17.2" r="2" />
    </>
  ),
  // Plain page, for anything the workbench has no opinion about.
  default: (
    <>
      <path d="M13.4 3.4H7.2A2.2 2.2 0 0 0 5 5.6v12.8a2.2 2.2 0 0 0 2.2 2.2h9.6a2.2 2.2 0 0 0 2.2-2.2V9Z" />
      <path d="M13.4 3.4V9H19" />
    </>
  ),
};
