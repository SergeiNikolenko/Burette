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
  | 'submit' | 'build' | 'status' | 'jobs' | 'cancel' | 'export';
export const WORKBENCH_OPERATIONS: readonly WorkbenchOperation[];
export type WorkbenchForceField = 'MMFF94' | 'MMFF94s' | 'UFF';
export type WorkbenchJobKind = 'properties' | 'energy' | 'energy_forces' | 'orbital_cube' | 'insert_fragment' | 'hydrogens' | 'polymer' | 'smiles' | 'peptide';
export type WorkbenchJobKindDescription = { operation: 'submit' | 'build'; engine: string; requires: string; params: Record<string, unknown>; artifacts: string[] };
export type WorkbenchPolymerEndGroup = 'hydrogen' | 'methyl' | 'hydroxyl' | 'phenyl' | 'tert-butyl';
export const WORKBENCH_JOB_KINDS: Readonly<Record<WorkbenchJobKind, WorkbenchJobKindDescription>>;
export const WORKBENCH_RUNTIMES: readonly ['browser-agent-shell'];

export type WorkbenchJobRequest =
  | { kind: 'energy'; params: { forceField: WorkbenchForceField } }
  | { kind: 'energy_forces'; params: { forceField: WorkbenchForceField } }
  | { kind: 'properties'; params: { chargeModel?: 'Gasteiger' } }
  | { kind: 'orbital_cube'; params: { field: 'orbital' | 'density' | 'spin-density'; orbitalIndex?: number; spacingAngstrom?: number; paddingAngstrom?: number } }
  | { kind: 'insert_fragment'; params: { library?: string; smiles?: string; atomIndex?: number } }
  | { kind: 'hydrogens'; params: { mode: 'add' | 'remove' } }
  | { kind: 'polymer'; params: { head: number; tail: number; headLeaving: number; tailLeaving: number; count: number; bondLengthAngstrom: number;
      tacticity?: 'isotactic' | 'syndiotactic' | 'atactic'; headEnd: WorkbenchPolymerEndGroup; tailEnd: WorkbenchPolymerEndGroup; relax: boolean } };
/** Jobs that build a new structure without a source document (operation `build`). */
export type WorkbenchBuildJobRequest =
  | { kind: 'smiles'; params: { smiles: string } }
  | { kind: 'peptide'; params: { sequence: string; codes: 'one' | 'three'; chirality: 'L' | 'D'; phiDegrees: number; psiDegrees: number;
      nTerminus: 'amine' | 'ammonium'; cTerminus: 'acid' | 'carboxylate'; chain: string } };

type DocumentTarget = { documentId?: string; expectedSourceRevision?: string };
type Page = { offset: number; limit: number };
export type WorkbenchRequest = { type: 'workbench' } & (
  | { operation: 'capabilities' }
  | ({ operation: 'observe' } & DocumentTarget)
  | ({ operation: 'orbitals' } & DocumentTarget & Page)
  | ({ operation: 'submit'; operationId: string; job: WorkbenchJobRequest; expectedSourceRevision: string; documentId?: string })
  | { operation: 'build'; operationId: string; job: WorkbenchBuildJobRequest }
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
