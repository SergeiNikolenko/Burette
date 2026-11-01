export type IndexedTrajectoryIdentity = {
  sourceId: string; modelId: string; structureRef: string;
  frameIndex: number; frameCount: number; segmentIndex: number;
};
export type IndexedTrajectoryFrameRequest = {
  type?: 'indexed_trajectory_frame'; offset?: number; limit?: number; includeSummary?: boolean;
  structureRef?: string; expected?: Partial<IndexedTrajectoryIdentity>;
};
export type IndexedTrajectoryFrame = IndexedTrajectoryIdentity & {
  available: true; time: { value: number; unit: 'ps' | 'step' }; step?: number;
  units: { position: 'angstrom'; velocity?: 'angstrom/ps'; force?: 'kcal/mol/angstrom' };
  offset: number; total: number;
  summary: { maxForce?: number; rmsForce?: number; rmsSpeed?: number };
  atoms: Array<{ index: number; sourceAtomIndex: number; element?: string; position: number[]; velocity?: number[]; force?: number[] }>;
};
export type IndexedTrajectoryFrameResult = IndexedTrajectoryFrame | { available: false };
export function validateTrajectoryFrameRequest(request?: IndexedTrajectoryFrameRequest): IndexedTrajectoryFrameRequest & { offset: number; limit: number };
export function validateTrajectoryFrameResult(value: unknown, request?: IndexedTrajectoryFrameRequest): IndexedTrajectoryFrameResult;
export function readActiveTrajectoryFrame(viewer: unknown, request: IndexedTrajectoryFrameRequest, frameData: (model: unknown, options: IndexedTrajectoryFrameRequest) => unknown): IndexedTrajectoryFrameResult;
