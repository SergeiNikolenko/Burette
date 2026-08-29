import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { z } from "zod/v4";
import type {
  KetcherAgentErrorCode,
  KetcherRevisionState,
  KetcherStructureInput,
} from "@burette/ketcher-agent-contract";

const TOKEN_VERSION = "k1";
const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_TOKEN_CHARS = 128 * 1024;
const MAX_DECOMPRESSED_BYTES = 192 * 1024;
export const MAX_HOSTED_KETCHER_INLINE_BYTES = 64 * 1024;

const revisionStateSchema = z.object({
  surfaceId: z.string().min(1).max(160),
  phase: z.enum(["loading", "ready", "applying", "exporting", "recovering", "error", "disposed"]),
  structureRevision: z.number().int().nonnegative(),
  interactionRevision: z.number().int().nonnegative(),
  persistedRevision: z.number().int().nonnegative(),
  dirty: z.boolean(),
}).strict();

const structureInputSchema = z.object({
  format: z.enum(["ket", "mol", "rxn", "smiles"]),
  content: z.string(),
}).strict();

const lastActionSchema = z.object({
  ok: z.boolean(),
  command: z.string().max(64),
  actionId: z.string().max(128).optional(),
  status: z.string().max(64).optional(),
  formats: z.array(z.string().max(32)).max(7).optional(),
  delivery: z.enum(["inline", "artifact", "download"]).optional(),
  format: z.string().max(32).optional(),
  suggestedBasename: z.string().max(255).optional(),
}).strict().nullable();

const continuationSchema = z.object({
  schemaVersion: z.literal(1),
  surfaceId: z.string().min(1).max(160),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  state: revisionStateSchema,
  input: structureInputSchema.nullable(),
  selectedAtoms: z.array(z.number().int().nonnegative()).max(256),
  highlightedAtoms: z.array(z.number().int().nonnegative()).max(256),
  lastAction: lastActionSchema,
}).strict();

export type KetcherContinuationPayload = {
  schemaVersion: 1;
  surfaceId: string;
  issuedAt: number;
  expiresAt: number;
  state: KetcherRevisionState;
  input: KetcherStructureInput | null;
  selectedAtoms: number[];
  highlightedAtoms: number[];
  lastAction: {
    ok: boolean;
    command: string;
    actionId?: string;
    status?: string;
    formats?: string[];
    delivery?: "inline" | "artifact" | "download";
    format?: string;
    suggestedBasename?: string;
  } | null;
};

type TokenOptions = {
  secret?: string;
  now?: number;
};

type TokenFailure = {
  ok: false;
  error: { code: KetcherAgentErrorCode; message: string };
};

export class KetcherStateConfigurationError extends Error {
  constructor() {
    super("KETCHER_STATE_SECRET is required for hosted Ketcher in production.");
    this.name = "KetcherStateConfigurationError";
  }
}

export function createKetcherContinuationPayload(
  value: Omit<KetcherContinuationPayload, "schemaVersion" | "issuedAt" | "expiresAt">,
  now = Date.now(),
): KetcherContinuationPayload {
  return {
    schemaVersion: 1,
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_MS,
    ...value,
  };
}

export function encodeKetcherContinuation(
  payload: KetcherContinuationPayload,
  options: TokenOptions = {},
): string {
  const parsed = parsePayload(payload);
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(parsed), "utf8"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(options.secret), iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const token = [
    TOKEN_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
  if (token.length > MAX_TOKEN_CHARS) {
    throw new Error("The hosted Ketcher continuation token exceeds its bounded size.");
  }
  return token;
}

export function decodeKetcherContinuation(
  token: string,
  options: TokenOptions = {},
): { ok: true; value: KetcherContinuationPayload } | TokenFailure {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    return tokenFailure("The hosted Ketcher state token is invalid.");
  }
  const [version, rawIv, rawTag, rawEncrypted, ...extra] = token.split(".");
  if (version !== TOKEN_VERSION || !rawIv || !rawTag || !rawEncrypted || extra.length > 0) {
    return tokenFailure("The hosted Ketcher state token is invalid.");
  }
  const key = tokenKey(options.secret);
  try {
    const iv = decodeCanonicalBase64Url(rawIv);
    const tag = decodeCanonicalBase64Url(rawTag);
    const encrypted = decodeCanonicalBase64Url(rawEncrypted);
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
      return tokenFailure("The hosted Ketcher state token is invalid.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      iv,
    );
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    const decoded = inflateRawSync(compressed, {
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    });
    const payload = parsePayload(JSON.parse(decoded.toString("utf8")));
    if ((options.now ?? Date.now()) > payload.expiresAt) {
      return tokenFailure("The hosted Ketcher state token has expired.");
    }
    return { ok: true, value: payload };
  } catch {
    return tokenFailure("The hosted Ketcher state token is invalid.");
  }
}

function decodeCanonicalBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Non-canonical base64url value.");
  }
  return decoded;
}

function parsePayload(value: unknown): KetcherContinuationPayload {
  const parsed = continuationSchema.parse(value) as KetcherContinuationPayload;
  if (parsed.surfaceId !== parsed.state.surfaceId || parsed.expiresAt <= parsed.issuedAt) {
    throw new Error("Invalid hosted Ketcher continuation state.");
  }
  if (parsed.input?.content) {
    const byteCount = new TextEncoder().encode(parsed.input.content).byteLength;
    if (byteCount > MAX_HOSTED_KETCHER_INLINE_BYTES) {
      throw new Error("Hosted Ketcher structure content exceeds 64 KiB.");
    }
  }
  return parsed;
}

function tokenKey(explicitSecret: string | undefined): Buffer {
  const secret = explicitSecret?.trim() || process.env.KETCHER_STATE_SECRET?.trim();
  const localRuntime = process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";
  if (!secret && !localRuntime) {
    throw new KetcherStateConfigurationError();
  }
  return createHash("sha256")
    .update(secret || "burette-local-ketcher-state-v1", "utf8")
    .digest();
}

function tokenFailure(message: string): TokenFailure {
  return { ok: false, error: { code: "STALE_TARGET", message } };
}
