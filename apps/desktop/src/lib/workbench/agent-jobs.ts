import type { WorkbenchBuildJobKind, WorkbenchJobParams, WorkbenchSubmitJobKind } from "../../../../../scripts/workbench-agent-contract.mjs";
import type { Snapshot } from "./agent-source";
import { builderJobs, buildJobs } from "./agent-builder-jobs";
import { graphJobs } from "./agent-graph-jobs";
import { coordinateAlignJob, measurementSetJob } from "./agent-coordinate-jobs";
import { metadataJob } from "./agent-metadata";
import { orbitalCubeJob } from "./agent-orbital-job";
import { pairDistributionJob } from "./agent-pair-distribution";
import { crystalTransformJob, pointGroupJob, powderXrdJob, spaceGroupJob } from "./agent-crystal-jobs";

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
export type AgentJobRunner<K extends WorkbenchSubmitJobKind> = {
  /** Why no request of this kind can run on the revision (reported by `observe`), or null. */
  unavailable: (snapshot: Snapshot) => string | null;
  /** Why these validated params cannot run on the revision, checked before queueing. */
  paramsUnavailable?: (snapshot: Snapshot, params: WorkbenchJobParams<K>) => string | null;
  run: (input: Snapshot, params: WorkbenchJobParams<K>, context: AgentJobContext) => Promise<AgentJobOutput>;
};

/** Builds a new structure without a source document; `context.stem` is not defined for it. */
export type AgentBuildRunner<K extends WorkbenchBuildJobKind> = {
  run: (params: WorkbenchJobParams<K>, context: Omit<AgentJobContext, "stem">) => Promise<AgentJobOutput>;
};

/**
 * Every job kind of the shared contract (scripts/workbench-agent-contract.mjs) has
 * exactly one runner here (`build: true` kinds in AGENT_BUILDS); the mapped types
 * make a missing or extra kind a type error.
 */
export const AGENT_JOBS: { [K in WorkbenchSubmitJobKind]: AgentJobRunner<K> } = {
  ...graphJobs,
  ...builderJobs,
  metadata_edit: metadataJob,
  measurement_set: measurementSetJob,
  coordinate_align: coordinateAlignJob,
  pair_distribution: pairDistributionJob,
  point_group: pointGroupJob,
  space_group: spaceGroupJob,
  powder_xrd: powderXrdJob,
  crystal_transform: crystalTransformJob,
  orbital_cube: orbitalCubeJob,
};

export const AGENT_BUILDS: { [K in WorkbenchBuildJobKind]: AgentBuildRunner<K> } = buildJobs;
