import type { WorkbenchJobKind, WorkbenchJobParams } from "../../../../../scripts/workbench-agent-contract.mjs";
import type { Snapshot } from "./agent-source";
import { graphJobs } from "./agent-graph-jobs";
import { metadataJob } from "./agent-metadata";
import { orbitalCubeJob } from "./agent-orbital-job";
import { pairDistributionJob } from "./agent-pair-distribution";

export type AgentArtifact = { name: string; fileName: string; mimeType: string; content: string; byteCount: number; sha256: string };
export type AgentJobOutput = { summary: Record<string, unknown>; artifacts: AgentArtifact[] };
export type AgentJobContext = {
  signal: AbortSignal; timeoutMs: number;
  /** File-name stem of the source document. */
  stem: string;
  /** Hashes and bounds one exportable artifact. */
  artifact: (name: string, fileName: string, mimeType: string, content: string) => Promise<AgentArtifact>;
};

/**
 * Runs one typed job kind on an immutable source revision. The controller owns
 * queueing, deduplication, cancellation, stale/closed binding and export; a runner
 * only states availability and computes a bounded summary plus artifacts.
 */
export type AgentJobRunner<K extends WorkbenchJobKind> = {
  /** Why no request of this kind can run on the revision (reported by `observe`), or null. */
  unavailable: (snapshot: Snapshot) => string | null;
  /** Why these validated params cannot run on the revision, checked before queueing. */
  paramsUnavailable?: (snapshot: Snapshot, params: WorkbenchJobParams<K>) => string | null;
  run: (input: Snapshot, params: WorkbenchJobParams<K>, context: AgentJobContext) => Promise<AgentJobOutput>;
};

/**
 * Every job kind of the shared contract (scripts/workbench-agent-contract.mjs) has
 * exactly one runner here; the mapped type makes a missing or extra kind a type error.
 */
export const AGENT_JOBS: { [K in WorkbenchJobKind]: AgentJobRunner<K> } = {
  ...graphJobs,
  metadata_edit: metadataJob,
  pair_distribution: pairDistributionJob,
  orbital_cube: orbitalCubeJob,
};
