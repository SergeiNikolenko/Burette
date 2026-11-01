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
export type WorkbenchJobKind = 'orbital_cube';
export type WorkbenchJobKindDescription = { engine: string; requires: string; params: Record<string, unknown>; artifacts: string[] };
export const WORKBENCH_JOB_KINDS: Readonly<Record<WorkbenchJobKind, WorkbenchJobKindDescription>>;
export const WORKBENCH_RUNTIMES: readonly ['browser-agent-shell'];

export type WorkbenchJobRequest =
  | { kind: 'orbital_cube'; params: { field: 'orbital' | 'density' | 'spin-density'; orbitalIndex?: number; spacingAngstrom?: number; paddingAngstrom?: number } };

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
