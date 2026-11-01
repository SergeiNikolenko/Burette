import { validateTrajectoryFrameRequest, validateTrajectoryFrameResult, type IndexedTrajectoryFrameRequest } from '../../../../scripts/trajectory-frame-data.mjs';
import { requestViewerAction } from './viewer-bridge';
export type { IndexedTrajectoryFrame, IndexedTrajectoryIdentity, IndexedTrajectoryFrameResult } from '../../../../scripts/trajectory-frame-data.mjs';

/** A bounded read of the displayed model. It never changes the frame or guesses missing data. */
export async function requestIndexedTrajectoryFrame(documentId: string, options: IndexedTrajectoryFrameRequest = {}, signal?: AbortSignal) {
  const request = validateTrajectoryFrameRequest(options);
  const result = await requestViewerAction(documentId, { type: 'indexed_trajectory_frame', ...request }, 10_000, signal);
  signal?.throwIfAborted();
  return validateTrajectoryFrameResult(result, request);
}
