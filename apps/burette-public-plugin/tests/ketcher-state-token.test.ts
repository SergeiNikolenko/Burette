import { describe, expect, test } from "bun:test";
import {
  decodeKetcherContinuation,
  encodeKetcherContinuation,
  type KetcherContinuationPayload,
} from "../lib/ketcher-state-token";

function payload(overrides: Partial<KetcherContinuationPayload> = {}): KetcherContinuationPayload {
  return {
    schemaVersion: 1,
    surfaceId: "hosted-ketcher:test",
    issuedAt: 1_000,
    expiresAt: 2_000,
    state: {
      surfaceId: "hosted-ketcher:test",
      phase: "ready",
      structureRevision: 1,
      interactionRevision: 1,
      persistedRevision: 1,
      dirty: false,
    },
    input: { format: "smiles", content: "CCO" },
    selectedAtoms: [],
    highlightedAtoms: [],
    lastAction: null,
    ...overrides,
  };
}

describe("hosted Ketcher continuation token", () => {
  test("round-trips bounded state across independent decoder calls", () => {
    const token = encodeKetcherContinuation(payload(), {
      secret: "test-secret",
    });
    expect(decodeKetcherContinuation(token, {
      secret: "test-secret",
      now: 1_500,
    })).toEqual({ ok: true, value: payload() });
  });

  test("rejects tampered and expired state without exposing payload details", () => {
    const token = encodeKetcherContinuation(payload(), {
      secret: "test-secret",
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(decodeKetcherContinuation(tampered, {
      secret: "test-secret",
      now: 1_500,
    })).toEqual({
      ok: false,
      error: { code: "STALE_TARGET", message: "The hosted Ketcher state token is invalid." },
    });
    expect(decodeKetcherContinuation(token, {
      secret: "test-secret",
      now: 2_001,
    })).toEqual({
      ok: false,
      error: { code: "STALE_TARGET", message: "The hosted Ketcher state token has expired." },
    });
  });
});
