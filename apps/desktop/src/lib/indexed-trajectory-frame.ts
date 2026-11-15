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

export type IndexedTrajectoryScanPage = { sourceId: string; frameCount: number; offset: number;
  frames: { frameIndex: number; time: { value: number; unit: "ps" | "step" }; positions: [number, number, number][] }[] };
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);

/** Positions of 2–4 atoms in up to 200 frames of the displayed source; the scene does not move. */
export async function scanIndexedTrajectory(documentId: string, request: { atoms: number[]; offset: number; limit: number; sourceId: string }, signal?: AbortSignal) {
  const { atoms, offset, limit, sourceId } = request;
  const result = await requestViewerAction(documentId, { type: "indexed_trajectory_scan", atoms, offset, limit, expected: { sourceId } }, 30_000, signal);
  signal?.throwIfAborted();
  const page = result as IndexedTrajectoryScanPage;
  if (!page || page.sourceId !== sourceId || page.offset !== offset || !Number.isSafeInteger(page.frameCount) || !Array.isArray(page.frames)
    || page.frames.length !== Math.max(0, Math.min(limit, page.frameCount - offset))
    || page.frames.some((frame, at) => frame.frameIndex !== offset + at || !finite(frame.time?.value) || !["ps", "step"].includes(frame.time.unit)
      || !Array.isArray(frame.positions) || frame.positions.length !== atoms.length || frame.positions.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(finite))))
    throw new Error("The viewer returned an invalid trajectory scan.");
  return page;
}
