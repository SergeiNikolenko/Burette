import { describe, expect, test } from "bun:test";
import {
  hostedKetcherMutationBaseAfterRead,
  isOlderHostedKetcherState,
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
});
