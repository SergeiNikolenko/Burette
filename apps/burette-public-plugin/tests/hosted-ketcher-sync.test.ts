import { describe, expect, test } from "bun:test";
import {
  acceptHostedKetcherResult,
  createHostedKetcherLineage,
  createHostedKetcherPendingSync,
  hostedKetcherErrorFromToolResult,
  hostedKetcherMutationBaseAfterRead,
  hostedKetcherStateFromToolResult,
  isOlderHostedKetcherState,
  rememberHostedKetcherSuccessor,
  syncHostedKetcherEditorEdit,
  type HostedKetcherState,
} from "../../desktop/src/lib/hosted-ketcher-sync";

function state(token: string, structureRevision: number, interactionRevision = structureRevision): HostedKetcherState {
  return {
    surfaceId: "hosted-ketcher:test",
    continuationToken: token,
    snapshot: {
      structureRevision,
      interactionRevision,
    },
  } as HostedKetcherState;
}

describe("hosted Ketcher widget synchronization", () => {
  test("does not attach an editor read to a newer model continuation token", () => {
    const beforeEditorRead = state("token-before-model", 1);
    const afterModelMutation = state("token-after-model", 2);

    expect(hostedKetcherMutationBaseAfterRead(beforeEditorRead, afterModelMutation)).toBeNull();
    expect(hostedKetcherMutationBaseAfterRead(beforeEditorRead, beforeEditorRead)).toBe(beforeEditorRead);
  });

  test("does not retain a delayed widget response over a newer model state", () => {
    const delayedWidgetResponse = state("token-widget", 1);
    const newerModelState = state("token-model", 2);

    expect(isOlderHostedKetcherState(delayedWidgetResponse, newerModelState)).toBe(true);
    expect(isOlderHostedKetcherState(newerModelState, delayedWidgetResponse)).toBe(false);
  });

  test("rejects a lower-revision seed as part of its stale state result", async () => {
    const appliedSeeds: string[] = [];
    const accepted = await acceptHostedKetcherResult({
      current: state("token-current", 2),
      lineage: createHostedKetcherLineage(),
      result: {
        state: state("token-stale", 1),
        seed: "stale-canvas",
      },
      applySeed: async (seed) => {
        if (seed) appliedSeeds.push(seed);
      },
    });

    expect(accepted.accepted).toBe(false);
    expect(accepted.state.continuationToken).toBe("token-current");
    expect(appliedSeeds).toEqual([]);
  });

  test("orders same-revision get and persist tokens only through known lineage", () => {
    const initial = state("token-initial", 2);
    const afterGet = state("token-after-get", 2);
    const afterPersist = state("token-after-persist", 2);
    const unrelated = state("token-unrelated", 2);
    const lineage = createHostedKetcherLineage();

    rememberHostedKetcherSuccessor(lineage, initial, afterGet);
    rememberHostedKetcherSuccessor(lineage, afterGet, afterPersist);

    expect(isOlderHostedKetcherState(afterPersist, initial, lineage)).toBe(false);
    expect(isOlderHostedKetcherState(afterGet, afterPersist, lineage)).toBe(true);
    expect(isOlderHostedKetcherState(unrelated, initial, lineage)).toBe(true);
  });

  test("re-reads a manual edit on the winning model token after a read interleave", async () => {
    const initial = state("token-initial", 1);
    const modelWinner = state("token-model", 2);
    let current = initial;
    let readCount = 0;
    const mutations: Array<{ token: string; content: string }> = [];

    const outcome = await syncHostedKetcherEditorEdit({
      currentState: () => current,
      readCanvas: async () => {
        readCount += 1;
        if (readCount === 1) {
          current = modelWinner;
          return "canvas-before-model";
        }
        return "manual-edit-after-model";
      },
      mutate: async (base, content) => {
        mutations.push({ token: base.continuationToken, content });
        return { retry: false };
      },
    });

    expect(outcome).toBe("synced");
    expect(readCount).toBe(2);
    expect(mutations).toEqual([{
      token: "token-model",
      content: "manual-edit-after-model",
    }]);
  });

  test("re-reads a manual edit on the conflict winner token with one bounded retry", async () => {
    const initial = state("token-initial", 1);
    const modelWinner = state("token-model", 2);
    const widgetWinner = state("token-widget", 3);
    let current = initial;
    let readCount = 0;
    const mutationTokens: string[] = [];

    const outcome = await syncHostedKetcherEditorEdit({
      currentState: () => current,
      readCanvas: async () => {
        readCount += 1;
        return "manual-canvas-edit";
      },
      mutate: async (base) => {
        mutationTokens.push(base.continuationToken);
        if (mutationTokens.length === 1) {
          current = modelWinner;
          return { retry: true };
        }
        current = widgetWinner;
        return { retry: false };
      },
    });

    expect(outcome).toBe("synced");
    expect(readCount).toBe(2);
    expect(mutationTokens).toEqual(["token-initial", "token-model"]);
  });

  test("defers a state-less conflict until one read-only winner result triggers one resync", async () => {
    const conflictToolResult = {
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "REVISION_CONFLICT", message: "The token was consumed by another action." },
        result: {
          ok: false,
          command: "set_structure",
          actionId: "widget-conflict",
          error: { code: "REVISION_CONFLICT", message: "The token was consumed by another action." },
        },
        snapshot: null,
      },
    };
    for (const command of ["get_structure", "request_persist"] as const) {
      const initial = state(`token-initial-${command}`, 2, 3);
      const winner = state(`token-model-winner-${command}`, 2, 4);
      winner.snapshot = {
        ...winner.snapshot!,
        lastAction: { ok: true, command, actionId: `model-${command}` },
      } as HostedKetcherState["snapshot"];
      const pending = createHostedKetcherPendingSync();
      let current = initial;
      const mutationTokens: string[] = [];
      const winnerToolResult = {
        structuredContent: { snapshot: winner.snapshot },
        _meta: {
          ketcher: winner.snapshot,
          ketcherState: {
            surfaceId: winner.surfaceId,
            continuationToken: winner.continuationToken,
          },
        },
      };

      const sync = () => syncHostedKetcherEditorEdit({
        currentState: () => current,
        readCanvas: async () => "manual-canvas-edit",
        mutate: async (base) => {
          mutationTokens.push(base.continuationToken);
          if (mutationTokens.length > 1) return { retry: false };
          const error = hostedKetcherErrorFromToolResult(conflictToolResult);
          const successor = hostedKetcherStateFromToolResult(conflictToolResult);
          expect(error?.code).toBe("REVISION_CONFLICT");
          expect(successor).toBeNull();
          pending.defer();
          return { retry: false, pending: true };
        },
      });

      expect(await sync()).toBe("pending");
      expect(mutationTokens).toEqual([initial.continuationToken]);

      const acceptedWinner = hostedKetcherStateFromToolResult(winnerToolResult);
      expect(acceptedWinner?.snapshot?.structureRevision).toBe(2);
      expect(acceptedWinner?.snapshot?.interactionRevision).toBe(4);
      expect(isOlderHostedKetcherState(acceptedWinner!, current)).toBe(false);
      const previous = current;
      current = acceptedWinner!;
      if (pending.takeAfterStateAdvance(previous, current)) await sync();
      if (pending.takeAfterStateAdvance(previous, current)) await sync();

      expect(mutationTokens).toEqual([initial.continuationToken, winner.continuationToken]);
    }
  });
});
