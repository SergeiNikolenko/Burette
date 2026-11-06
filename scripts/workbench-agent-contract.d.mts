export const WORKBENCH_AGENT_API_VERSION: 'burette-workbench-agent/v1';
export const WORKBENCH_LIMITS: Readonly<{
  requestBytes: number;
  responseBytes: number;
  pageSize: number;
  defaultPageSize: number;
  activeJobs: number;
  queuedJobs: number;
  retainedJobs: number;
  artifactBytes: number;
  jobTimeoutMs: number;
  stringLength: number;
  constraints: number;
  optimizationIterations: number;
  conformers: number;
  batchFrames: number;
  batchAtomFrames: number;
}>;
export type WorkbenchOperation =
  | 'capabilities' | 'observe' | 'atoms' | 'orbitals'
  | 'submit' | 'build' | 'status' | 'jobs' | 'cancel' | 'export';
export const WORKBENCH_OPERATIONS: readonly WorkbenchOperation[];
export type WorkbenchForceField = 'MMFF94' | 'MMFF94s' | 'UFF';
/** External models, desktop app only: xTB methods and Avogadro energy packages. */
export type WorkbenchExternalEnergyModel = 'xtb:gfn2' | 'xtb:gfn1' | 'xtb:gfnff' | `avogadro:${string}/${string}`;
/** Models that evaluate or relax existing coordinates; LJ and external models need no bond graph. */
export type WorkbenchEnergyModel = WorkbenchForceField | 'LJ' | WorkbenchExternalEnergyModel;
export type WorkbenchJobKind = WorkbenchJobRequest['kind'];
/** Kinds that build a new structure without a source document (operation `build`). */
export type WorkbenchBuildJobKind = 'smiles' | 'peptide' | 'metal_complex' | 'nucleic_acid';
export type WorkbenchSubmitJobKind = Exclude<WorkbenchJobKind, WorkbenchBuildJobKind>;
export type WorkbenchPolymerEndGroup = 'hydrogen' | 'methyl' | 'hydroxyl' | 'phenyl' | 'tert-butyl';
export type WorkbenchOptimizeMethod = 'bfgs' | 'lbfgs' | 'fire' | 'abc-fire' | 'hybrid';
export type WorkbenchConstraint = { kind: 'freeze' | 'distance' | 'angle' | 'dihedral'; atoms: number[]; target?: number };
export type WorkbenchMetadataEdit = {
  atoms: { index: number; atomName?: string | null; residue?: { name: string; sequence: number; chain: string; insertionCode: string } | null }[];
  conformerLabel?: string | null;
};
export type WorkbenchCrystalTransform =
  | { operation: 'set_cell'; cell: [number, number, number][]; keep: 'fractional' | 'cartesian' }
  | { operation: 'wrap' | 'standard_orientation' | 'niggli' }
  | { operation: 'scale_volume'; volumeCubicAngstrom: number }
  | { operation: 'supercell'; repeats: [number, number, number] }
  | { operation: 'primitive' | 'conventional' | 'symmetrize' | 'asymmetric_unit'; toleranceAngstrom: number }
  | { operation: 'fill'; hallNumber: number };
export type WorkbenchMeasurementFragment = 'smaller' | 'first' | 'last';
export type WorkbenchMeasurementSet =
  | { measurement: 'distance'; atoms: number[]; valueAngstrom: number; fragment: WorkbenchMeasurementFragment }
  | { measurement: 'angle' | 'dihedral'; atoms: number[]; valueDegrees: number; fragment: WorkbenchMeasurementFragment };
export type WorkbenchCoordinateAlign = { originAtom: number; axisAtom?: number; axis?: 'x' | 'y' | 'z' };
/** The normalized `params` of one job kind. */
export type WorkbenchJobParams<K extends WorkbenchJobKind> = Extract<WorkbenchJobRequest, { kind: K }>['params'];
export type WorkbenchJobKindDescription = { operation: 'submit' | 'build'; engine: string; requires: string; params: Record<string, unknown>; artifacts: string[] };
export const WORKBENCH_JOB_KINDS: Readonly<Record<WorkbenchJobKind, WorkbenchJobKindDescription>>;
export const WORKBENCH_RUNTIMES: readonly ['browser-agent-shell', 'desktop-app'];

export type WorkbenchJobRequest =
  | { kind: 'energy'; params: { forceField: WorkbenchEnergyModel } }
  | { kind: 'energy_forces'; params: { forceField: WorkbenchEnergyModel } }
  | { kind: 'frame_energy_forces'; params: { forceField: WorkbenchEnergyModel; offset: number; count?: number } }
  | { kind: 'optimize'; params: { forceField: WorkbenchEnergyModel; method: WorkbenchOptimizeMethod; maxIterations: number; constraints: WorkbenchConstraint[] } }
  | { kind: 'prepare_3d'; params: { forceField: WorkbenchForceField; method: WorkbenchOptimizeMethod; seed: number; maxIterations: number } }
  | { kind: 'conformers'; params: { forceField: WorkbenchForceField; count: number; seed: number } }
  | { kind: 'metadata_edit'; params: WorkbenchMetadataEdit }
  | { kind: 'measurement_set'; params: WorkbenchMeasurementSet }
  | { kind: 'coordinate_align'; params: WorkbenchCoordinateAlign }
  | { kind: 'vibrational_spectrum'; params: { kind: 'ir' | 'raman'; source: 'file' | 'frame'; frameIndex?: number; scale?: number; offsetCm1?: number; fwhmCm1?: number; axisStartCm1?: number; axisEndCm1?: number } }
  | { kind: 'spectrum'; params: { kind: 'vcd' | 'mcd' | 'nmr' | 'electronic' | 'ecd' | 'dos'; source: 'file' | 'frame' | 'companion'; frameIndex?: number; atomicNumber?: number; scale?: number; offset?: number; fwhm?: number; axisStart?: number; axisEnd?: number } }
  | { kind: 'pair_distribution'; params: { rMax: number; binWidth: number; centre: string | null; neighbour: string | null } }
  | { kind: 'point_group'; params: { tolerance: 'tight' | 'normal' | 'loose' | 'very-loose' } }
  | { kind: 'space_group'; params: { toleranceAngstrom: number } }
  | { kind: 'powder_xrd'; params: { wavelengthAngstrom: number; twoThetaMinDegrees: number; twoThetaMaxDegrees: number } }
  | { kind: 'crystal_transform'; params: WorkbenchCrystalTransform }
  | { kind: 'properties'; params: { chargeModel?: 'Gasteiger' } }
  | { kind: 'orbital_cube'; params: { field: 'orbital' | 'density' | 'spin-density'; orbitalIndex?: number; spacingAngstrom?: number; paddingAngstrom?: number;
    grid?: { origin: [number, number, number]; axes: [[number, number, number], [number, number, number], [number, number, number]]; dimensions: [number, number, number] } } }
  | { kind: 'insert_fragment'; params: { library?: string; smiles?: string; atomIndex?: number } }
  | { kind: 'hydrogens'; params: { mode: 'add' | 'remove' } | { mode: 'ph'; pH: number } }
  | { kind: 'polymer'; params: { head: number; tail: number; headLeaving: number; tailLeaving: number; count: number; bondLengthAngstrom: number;
      tacticity?: 'isotactic' | 'syndiotactic' | 'atactic'; headEnd: WorkbenchPolymerEndGroup; tailEnd: WorkbenchPolymerEndGroup; relax: boolean } }
  | { kind: 'smiles'; params: { smiles: string; forceField: WorkbenchForceField; method: WorkbenchOptimizeMethod; seed: number; maxIterations: number } }
  | { kind: 'nucleic_acid'; params: { sequence: string; type: 'DNA' | 'RNA'; form: 'B' | 'A' | 'Z'; strands: 'double' | 'single'; fivePrime: 'hydroxyl' | 'phosphate' } }
  | { kind: 'metal_complex'; params: { metal: string; oxidationState: number; format: 'sdf' | 'mol';
      geometry: 'linear' | 'trigonal-planar' | 'tetrahedral' | 'square-planar' | 'trigonal-bipyramidal' | 'square-pyramidal' | 'octahedral';
      ligands: { ligand: string; sites: number[]; distanceAngstrom?: number }[] } }
  | { kind: 'peptide'; params: { sequence: string; codes: 'one' | 'three'; chirality: 'L' | 'D'; phiDegrees: number; psiDegrees: number;
      nTerminus: 'amine' | 'ammonium'; cTerminus: 'acid' | 'carboxylate'; chain: string } };

type DocumentTarget = { documentId?: string; expectedSourceRevision?: string };
type Page = { offset: number; limit: number };
export type WorkbenchRequest = { type: 'workbench' } & (
  | { operation: 'capabilities' }
  | ({ operation: 'observe' } & DocumentTarget)
  | ({ operation: 'atoms'; frameIndex?: number } & DocumentTarget & Page)
  | ({ operation: 'orbitals' } & DocumentTarget & Page)
  | ({ operation: 'submit'; operationId: string; job: Extract<WorkbenchJobRequest, { kind: WorkbenchSubmitJobKind }>; expectedSourceRevision: string; documentId?: string })
  | { operation: 'build'; operationId: string; job: Extract<WorkbenchJobRequest, { kind: WorkbenchBuildJobKind }> }
  | { operation: 'status'; jobId?: string; operationId?: string }
  | ({ operation: 'jobs' } & Page)
  | { operation: 'cancel'; jobId: string }
  | { operation: 'export'; jobId: string; artifact: string; allowStale: boolean }
);
export type WorkbenchRequestError = { code: string; message: string; details: unknown };
export function validateWorkbenchRequest(action: unknown): { ok: true; request: WorkbenchRequest } | { ok: false; error: WorkbenchRequestError };
export function workbenchContractSummary(): {
  apiVersion: typeof WORKBENCH_AGENT_API_VERSION;
  operations: readonly WorkbenchOperation[];
  jobs: typeof WORKBENCH_JOB_KINDS;
  limits: typeof WORKBENCH_LIMITS;
  runtimes: typeof WORKBENCH_RUNTIMES;
};
