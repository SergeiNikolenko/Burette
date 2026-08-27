import type { KetcherSnapshot } from "@burette/ketcher-agent-contract";

export type HostedKetcherState = {
  surfaceId: string;
  continuationToken: string;
  snapshot: KetcherSnapshot | null;
};

export function hostedKetcherMutationBaseAfterRead(
  beforeRead: HostedKetcherState,
  current: HostedKetcherState | null,
) {
  return current?.surfaceId === beforeRead.surfaceId
    && current.continuationToken === beforeRead.continuationToken
    ? beforeRead
    : null;
}

export function isOlderHostedKetcherState(
  next: HostedKetcherState,
  current: HostedKetcherState | null,
) {
  if (!current || current.surfaceId !== next.surfaceId) return false;
  if (current.snapshot && !next.snapshot) return true;
  if (!current.snapshot || !next.snapshot) return false;
  if (next.snapshot.structureRevision !== current.snapshot.structureRevision) {
    return next.snapshot.structureRevision < current.snapshot.structureRevision;
  }
  return next.snapshot.interactionRevision < current.snapshot.interactionRevision;
}
