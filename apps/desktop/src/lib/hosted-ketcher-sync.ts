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

export type HostedKetcherPendingSync = {
  defer: () => void;
  takeAfterStateAdvance: (
    previous: HostedKetcherState | null,
    next: HostedKetcherState,
  ) => boolean;
};

export function createHostedKetcherLineage(): HostedKetcherLineage {
  return new Map();
}

export function createHostedKetcherPendingSync(): HostedKetcherPendingSync {
  let pending = false;
  return {
    defer() {
      pending = true;
    },
    takeAfterStateAdvance(previous, next) {
      if (!pending) return false;
      if (!previous || previous.surfaceId !== next.surfaceId) {
        pending = false;
        return false;
      }
      if (previous.continuationToken === next.continuationToken) return false;
      pending = false;
      return true;
    },
  };
}

export function hostedKetcherStateFromToolResult(value: unknown): HostedKetcherState | null {
  const result = unknownRecord(value);
  const structuredContent = unknownRecord(result?.structuredContent);
  const metadata = unknownRecord(result?._meta) ?? unknownRecord(result?.meta);
  const rawState = unknownRecord(metadata?.ketcherState ?? structuredContent?.ketcherState);
  if (
    !rawState
    || typeof rawState.surfaceId !== "string"
    || typeof rawState.continuationToken !== "string"
    || !rawState.surfaceId.trim()
    || !rawState.continuationToken.trim()
  ) return null;
  return {
    surfaceId: rawState.surfaceId.slice(0, 160),
    continuationToken: rawState.continuationToken,
    snapshot: (unknownRecord(structuredContent?.snapshot) ?? unknownRecord(metadata?.ketcher)) as KetcherSnapshot | null,
  };
}

export function hostedKetcherErrorFromToolResult(value: unknown) {
  const result = unknownRecord(value);
  const structuredContent = unknownRecord(result?.structuredContent);
  const nestedResult = unknownRecord(structuredContent?.result);
  const error = unknownRecord(structuredContent?.error) ?? unknownRecord(nestedResult?.error);
  if (result?.isError !== true && structuredContent?.ok !== false) return null;
  return {
    code: typeof error?.code === "string" ? error.code : "SYNC_FAILED",
    message: typeof error?.message === "string" ? error.message : "Hosted Ketcher rejected the editor update.",
  };
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
  ) => Promise<{ retry: boolean; pending?: boolean; error?: Error }>;
}): Promise<"synced" | "pending" | "superseded" | "retry-exhausted"> {
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
    if (outcome.pending) return "pending";
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

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
