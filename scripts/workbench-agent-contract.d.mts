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
}>;
export type WorkbenchOperation =
  | 'capabilities' | 'observe' | 'orbitals'
  | 'submit' | 'status' | 'jobs' | 'cancel' | 'export';
export const WORKBENCH_OPERATIONS: readonly WorkbenchOperation[];
export type WorkbenchForceField = 'MMFF94' | 'MMFF94s' | 'UFF';
export type WorkbenchJobKind = 'properties' | 'energy' | 'energy_forces' | 'orbital_cube'
  | 'point_group' | 'space_group' | 'powder_xrd' | 'pair_distribution' | 'crystal_transform';
export type WorkbenchCrystalTransform =
  | { operation: 'set_cell'; cell: [number, number, number][]; keep: 'fractional' | 'cartesian' }
  | { operation: 'wrap' | 'standard_orientation' | 'niggli' }
  | { operation: 'scale_volume'; volumeCubicAngstrom: number }
  | { operation: 'supercell'; repeats: [number, number, number] }
  | { operation: 'primitive' | 'conventional' | 'symmetrize' | 'asymmetric_unit'; toleranceAngstrom: number }
  | { operation: 'fill'; hallNumber: number };
export type WorkbenchJobKindDescription = { engine: string; requires: string; params: Record<string, unknown>; artifacts: string[] };
export const WORKBENCH_JOB_KINDS: Readonly<Record<WorkbenchJobKind, WorkbenchJobKindDescription>>;
export const WORKBENCH_RUNTIMES: readonly ['browser-agent-shell'];

export type WorkbenchJobRequest =
  | { kind: 'energy'; params: { forceField: WorkbenchForceField } }
  | { kind: 'energy_forces'; params: { forceField: WorkbenchForceField } }
  | { kind: 'properties'; params: { chargeModel?: 'Gasteiger' } }
  | { kind: 'orbital_cube'; params: { field: 'orbital' | 'density' | 'spin-density'; orbitalIndex?: number; spacingAngstrom?: number; paddingAngstrom?: number } }
  | { kind: 'point_group'; params: { tolerance: 'tight' | 'normal' | 'loose' | 'very-loose' } }
  | { kind: 'space_group'; params: { toleranceAngstrom: number } }
  | { kind: 'powder_xrd'; params: { wavelengthAngstrom: number; twoThetaMinDegrees: number; twoThetaMaxDegrees: number } }
  | { kind: 'pair_distribution'; params: { rMaxAngstrom: number; binWidthAngstrom: number } }
  | { kind: 'crystal_transform'; params: WorkbenchCrystalTransform };

type DocumentTarget = { documentId?: string; expectedSourceRevision?: string };
type Page = { offset: number; limit: number };
export type WorkbenchRequest = { type: 'workbench' } & (
  | { operation: 'capabilities' }
  | ({ operation: 'observe' } & DocumentTarget)
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
