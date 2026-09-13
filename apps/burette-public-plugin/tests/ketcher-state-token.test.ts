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
    const parts = token.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const lastTagCharacter = parts[2].at(-1) ?? "";
    const alternateTagCharacter = alphabet[alphabet.indexOf(lastTagCharacter) ^ 1];
    const alternateEncoding = [
      parts[0],
      parts[1],
      `${parts[2].slice(0, -1)}${alternateTagCharacter}`,
      parts[3],
    ].join(".");
    expect(Buffer.from(parts[2], "base64url")).toEqual(Buffer.from(
      alternateEncoding.split(".")[2],
      "base64url",
    ));
    expect(decodeKetcherContinuation(alternateEncoding, {
      secret: "test-secret",
      now: 1_500,
    })).toEqual({
      ok: false,
      error: { code: "STALE_TARGET", message: "The hosted Ketcher state token is invalid." },
    });
    const firstEncryptedCharacter = parts[3][0];
    const bitFlipped = [
      parts[0],
      parts[1],
      parts[2],
      `${alphabet[alphabet.indexOf(firstEncryptedCharacter) ^ 1]}${parts[3].slice(1)}`,
    ].join(".");
    expect(Buffer.from(parts[3], "base64url")).not.toEqual(Buffer.from(bitFlipped.split(".")[3], "base64url"));
    expect(decodeKetcherContinuation(bitFlipped, {
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
