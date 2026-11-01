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
  | 'submit' | 'status' | 'jobs' | 'cancel' | 'export';
export const WORKBENCH_OPERATIONS: readonly WorkbenchOperation[];
export type WorkbenchForceField = 'MMFF94' | 'MMFF94s' | 'UFF';
export type WorkbenchJobKind = WorkbenchJobRequest['kind'];
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
/** The normalized `params` of one job kind. */
export type WorkbenchJobParams<K extends WorkbenchJobKind> = Extract<WorkbenchJobRequest, { kind: K }>['params'];
export type WorkbenchJobKindDescription = { engine: string; requires: string; params: Record<string, unknown>; artifacts: string[] };
export const WORKBENCH_JOB_KINDS: Readonly<Record<WorkbenchJobKind, WorkbenchJobKindDescription>>;
export const WORKBENCH_RUNTIMES: readonly ['browser-agent-shell'];

export type WorkbenchJobRequest =
  | { kind: 'energy'; params: { forceField: WorkbenchForceField } }
  | { kind: 'energy_forces'; params: { forceField: WorkbenchForceField } }
  | { kind: 'frame_energy_forces'; params: { forceField: WorkbenchForceField; offset: number; count?: number } }
  | { kind: 'optimize'; params: { forceField: WorkbenchForceField; method: WorkbenchOptimizeMethod; maxIterations: number; constraints: WorkbenchConstraint[] } }
  | { kind: 'prepare_3d'; params: { forceField: WorkbenchForceField; method: WorkbenchOptimizeMethod; seed: number; maxIterations: number } }
  | { kind: 'conformers'; params: { forceField: WorkbenchForceField; count: number; seed: number } }
  | { kind: 'metadata_edit'; params: WorkbenchMetadataEdit }
  | { kind: 'pair_distribution'; params: { rMax: number; binWidth: number; centre: string | null; neighbour: string | null } }
  | { kind: 'point_group'; params: { tolerance: 'tight' | 'normal' | 'loose' | 'very-loose' } }
  | { kind: 'space_group'; params: { toleranceAngstrom: number } }
  | { kind: 'powder_xrd'; params: { wavelengthAngstrom: number; twoThetaMinDegrees: number; twoThetaMaxDegrees: number } }
  | { kind: 'crystal_transform'; params: WorkbenchCrystalTransform }
  | { kind: 'properties'; params: { chargeModel?: 'Gasteiger' } }
  | { kind: 'orbital_cube'; params: { field: 'orbital' | 'density' | 'spin-density'; orbitalIndex?: number; spacingAngstrom?: number; paddingAngstrom?: number } };

type DocumentTarget = { documentId?: string; expectedSourceRevision?: string };
type Page = { offset: number; limit: number };
export type WorkbenchRequest = { type: 'workbench' } & (
  | { operation: 'capabilities' }
  | ({ operation: 'observe' } & DocumentTarget)
  | ({ operation: 'atoms'; frameIndex?: number } & DocumentTarget & Page)
  | ({ operation: 'orbitals' } & DocumentTarget & Page)
  | ({ operation: 'submit'; operationId: string; job: WorkbenchJobRequest; expectedSourceRevision: string; documentId?: string })
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
