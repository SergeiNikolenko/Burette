import type { KetcherSnapshot } from "@burette/ketcher-agent-contract";

const MAX_HOSTED_KETCHER_LINEAGE = 64;
const MAX_HOSTED_KETCHER_EDIT_SYNC_ATTEMPTS = 2;

export type HostedKetcherState = {
  surfaceId: string;
  continuationToken: string;
  snapshot: KetcherSnapshot | null;
};

export type HostedKetcherResult<TSeed> = {
  state: HostedKetcherState;
  seed?: TSeed | null;
};

export type HostedKetcherLineage = Map<string, string>;

export function createHostedKetcherLineage(): HostedKetcherLineage {
  return new Map();
}

export function rememberHostedKetcherSuccessor(
  lineage: HostedKetcherLineage,
  predecessor: HostedKetcherState,
  successor: HostedKetcherState,
) {
  if (
    predecessor.surfaceId !== successor.surfaceId
    || predecessor.continuationToken === successor.continuationToken
    || compareHostedKetcherRevisions(successor, predecessor) < 0
  ) return;
  lineage.delete(successor.continuationToken);
  lineage.set(successor.continuationToken, predecessor.continuationToken);
  while (lineage.size > MAX_HOSTED_KETCHER_LINEAGE) {
    const oldest = lineage.keys().next().value;
    if (typeof oldest !== "string") break;
    lineage.delete(oldest);
  }
}

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
  lineage?: HostedKetcherLineage,
) {
  if (!current || current.surfaceId !== next.surfaceId) return false;
  const revisionOrder = compareHostedKetcherRevisions(next, current);
  if (revisionOrder !== 0) return revisionOrder < 0;
  if (next.continuationToken === current.continuationToken) return false;
  return !lineage || !isTokenDescendantOf(
    next.continuationToken,
    current.continuationToken,
    lineage,
  );
}

export async function acceptHostedKetcherResult<TSeed>({
  current,
  lineage,
  result,
  predecessor,
  applySeed,
}: {
  current: HostedKetcherState | null;
  lineage: HostedKetcherLineage;
  result: HostedKetcherResult<TSeed>;
  predecessor?: HostedKetcherState;
  applySeed: (seed: TSeed | null) => Promise<void>;
}): Promise<{ accepted: boolean; state: HostedKetcherState }> {
  if (predecessor) rememberHostedKetcherSuccessor(lineage, predecessor, result.state);
  if (isOlderHostedKetcherState(result.state, current, lineage)) {
    return { accepted: false, state: current ?? result.state };
  }
  if (Object.hasOwn(result, "seed")) await applySeed(result.seed ?? null);
  return { accepted: true, state: result.state };
}

export async function syncHostedKetcherEditorEdit({
  currentState,
  readCanvas,
  mutate,
}: {
  currentState: () => HostedKetcherState | null;
  readCanvas: () => Promise<string>;
  mutate: (
    base: HostedKetcherState,
    content: string,
  ) => Promise<{ retry: boolean; error?: Error }>;
}): Promise<"synced" | "superseded" | "retry-exhausted"> {
  for (let attempt = 0; attempt < MAX_HOSTED_KETCHER_EDIT_SYNC_ATTEMPTS; attempt += 1) {
    const beforeRead = currentState();
    if (!beforeRead?.snapshot) return "superseded";
    const content = await readCanvas();
    const mutationBase = hostedKetcherMutationBaseAfterRead(beforeRead, currentState());
    if (!mutationBase?.snapshot) {
      if (attempt + 1 < MAX_HOSTED_KETCHER_EDIT_SYNC_ATTEMPTS) continue;
      return "superseded";
    }
    const outcome = await mutate(mutationBase, content);
    if (!outcome.retry) {
      if (outcome.error) throw outcome.error;
      return "synced";
    }
    if (attempt + 1 >= MAX_HOSTED_KETCHER_EDIT_SYNC_ATTEMPTS) {
      if (outcome.error) throw outcome.error;
      return "retry-exhausted";
    }
  }
  return "retry-exhausted";
}

function compareHostedKetcherRevisions(
  left: HostedKetcherState,
  right: HostedKetcherState,
) {
  if (left.snapshot && !right.snapshot) return 1;
  if (!left.snapshot && right.snapshot) return -1;
  if (!left.snapshot || !right.snapshot) return 0;
  if (left.snapshot.structureRevision !== right.snapshot.structureRevision) {
    return left.snapshot.structureRevision - right.snapshot.structureRevision;
  }
  return left.snapshot.interactionRevision - right.snapshot.interactionRevision;
}

function isTokenDescendantOf(
  candidate: string,
  ancestor: string,
  lineage: HostedKetcherLineage,
) {
  const visited = new Set<string>();
  let token = candidate;
  while (visited.size < MAX_HOSTED_KETCHER_LINEAGE && !visited.has(token)) {
    if (token === ancestor) return true;
    visited.add(token);
    const predecessor = lineage.get(token);
    if (!predecessor) return false;
    token = predecessor;
  }
  return false;
}
