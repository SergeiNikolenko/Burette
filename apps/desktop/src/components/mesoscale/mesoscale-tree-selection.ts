import { MESOSCALE_SELECTION_BATCH_LIMIT } from "../../lib/mesoscale-contract";

export function inclusiveMesoscaleTreeRange(refs: string[], startRef: string, endRef: string) {
  const start = refs.indexOf(startRef);
  const end = refs.indexOf(endRef);
  if (start < 0 || end < 0) return [endRef];
  return refs.slice(Math.min(start, end), Math.max(start, end) + 1);
}

export function mesoscaleTreeSelectionError(refs: string[]) {
  return refs.length > MESOSCALE_SELECTION_BATCH_LIMIT
    ? `Select at most ${MESOSCALE_SELECTION_BATCH_LIMIT.toLocaleString()} visible structures at once`
    : null;
}
