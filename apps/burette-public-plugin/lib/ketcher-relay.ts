import { createHash, randomUUID } from "node:crypto";
import {
  KETCHER_AGENT_LIMITS,
  applyInteractionRevision,
  applyStructuralRevision,
  createKetcherSnapshot,
  createRevisionState,
  markPersisted,
  normalizeStructureInput,
  validateKetcherAction,
  type KetcherAgentErrorCode,
  type KetcherControlAction,
  type KetcherSnapshot,
  type KetcherStructureInput,
} from "@burette/ketcher-agent-contract";
import {
  MAX_HOSTED_KETCHER_INLINE_BYTES,
  KetcherStateConfigurationError,
  createKetcherContinuationPayload,
  decodeKetcherContinuation,
  encodeKetcherContinuation,
  type KetcherContinuationPayload,
} from "@/lib/ketcher-state-token";

type RelaySurface = KetcherContinuationPayload;

type HostedKetcherAction = KetcherControlAction & {
  continuationToken: string;
};

export type HostedKetcherActionResult = {
  ok: boolean;
  command: string;
  actionId?: string;
  continuationToken?: string;
  result?: Record<string, unknown>;
  snapshot?: KetcherSnapshot;
  error?: { code: KetcherAgentErrorCode; message: string };
};

export function createHostedKetcherSurface(seed?: { format: string; content: string }) {
  const surfaceId = `hosted-ketcher:${randomUUID()}`;
  const input = seed ? normalizeStructureInput(seed) : { ok: true as const, value: undefined };
  if (!input.ok) return input;
  if (input.value?.content && utf8ByteLength(input.value.content) > MAX_HOSTED_KETCHER_INLINE_BYTES) {
    return relayFailure("PAYLOAD_TOO_LARGE", "Hosted Ketcher structure content exceeds 64 KiB.");
  }
  let state = createRevisionState(surfaceId, "ready");
  if (input.value) state = markPersisted(applyStructuralRevision(state));
  const surface = createKetcherContinuationPayload({
    surfaceId,
    state,
    input: input.value ?? null,
    selectedAtoms: [],
    highlightedAtoms: [],
    lastAction: null,
  });
  try {
    return {
      ok: true as const,
      surface,
      continuationToken: encodeKetcherContinuation(surface),
      snapshot: snapshot(surface),
    };
  } catch (error) {
    return configurationFailure(error);
  }
}

export function hostedKetcherSnapshot(continuationToken: string) {
  const decoded = decodeSafely(continuationToken);
  return decoded.ok ? snapshot(decoded.value) : null;
}

export function executeHostedKetcherAction(rawAction: unknown): HostedKetcherActionResult {
  if (!isRecord(rawAction) || typeof rawAction.continuationToken !== "string") {
    return failure("control_ketcher", "INVALID_INPUT", "A hosted Ketcher continuation token is required.");
  }
  const { continuationToken, ...actionPayload } = rawAction;
  const validated = validateKetcherAction(actionPayload);
  if (!validated.ok) return failure("control_ketcher", validated.error.code, validated.error.message);
  const action = { ...validated.value, continuationToken } as HostedKetcherAction & { input?: KetcherStructureInput };
  const decoded = decodeSafely(continuationToken);
  if (!decoded.ok) return failure(action.command, decoded.error.code, decoded.error.message, action.actionId);
  const surface = decoded.value;
  if (surface.surfaceId !== action.surfaceId) {
    return failure(action.command, "STALE_TARGET", "The hosted Ketcher continuation token belongs to another surface.", action.actionId);
  }
  const actionHash = stableActionHash(action);
  if (surface.lastAction?.actionId === action.actionId) {
    if (surface.lastAction.status !== actionHash) {
      return failure(action.command, "REPLAY_CONFLICT", "actionId was already used for another payload.", action.actionId, surface, continuationToken);
    }
    return replaySuccess(surface, continuationToken);
  }
  if (surface.state.phase !== "ready") {
    return failure(action.command, "NOT_READY", "The hosted Ketcher surface is not ready.", action.actionId, surface, continuationToken);
  }
  if (action.expectedRevision !== surface.state.structureRevision) {
    return failure(action.command, "REVISION_CONFLICT", "The hosted Ketcher structure revision is stale.", action.actionId, surface, continuationToken);
  }

  const result = action.command === "set_structure"
    ? applyStructure(surface, action)
    : action.command === "clear_structure"
      ? clearStructure(surface, action)
      : action.command === "highlight_atoms"
        ? applyHighlights(surface, action)
        : action.command === "get_structure"
          ? exportStructure(surface, action)
          : requestPersist(surface, action);
  if (!result.ok) return { ...result, continuationToken };
  surface.lastAction = replayState(action, actionHash);
  const refreshed = refreshLifetime(surface);
  try {
    const nextToken = encodeKetcherContinuation(refreshed);
    return { ...result, continuationToken: nextToken, snapshot: snapshot(refreshed) };
  } catch (error) {
    return configurationActionFailure(action.command, action.actionId, error);
  }
}

function applyStructure(surface: RelaySurface, action: HostedKetcherAction & { input?: KetcherStructureInput }) {
  if (action.input?.contentRef) {
    return failure(action.command, "TRANSPORT_UNAVAILABLE", "Hosted relay contentRef resolution is not configured.", action.actionId, surface, action.continuationToken);
  }
  if (action.input?.content && utf8ByteLength(action.input.content) > MAX_HOSTED_KETCHER_INLINE_BYTES) {
    return failure(action.command, "PAYLOAD_TOO_LARGE", "Hosted Ketcher structure content exceeds 64 KiB.", action.actionId, surface, action.continuationToken);
  }
  surface.input = action.input ?? null;
  surface.selectedAtoms = [];
  surface.highlightedAtoms = [];
  surface.state = applyStructuralRevision(surface.state);
  return success(action.command, action.actionId, surface, action.continuationToken, {
    ketcherSeed: seedFor(surface),
  });
}

function clearStructure(surface: RelaySurface, action: HostedKetcherAction) {
  surface.input = null;
  surface.selectedAtoms = [];
  surface.highlightedAtoms = [];
  surface.state = applyStructuralRevision(surface.state);
  return success(action.command, action.actionId, surface, action.continuationToken, { ketcherSeed: null });
}

function applyHighlights(surface: RelaySurface, action: HostedKetcherAction) {
  const indexes = action.indexes ?? [];
  const atomCount = structureSummary(surface.input).atomCount;
  if (indexes.some((index) => index >= atomCount)) {
    return failure(action.command, "INVALID_ATOM_INDEX", "An atom index is outside the current structure.", action.actionId, surface, action.continuationToken);
  }
  surface.highlightedAtoms = [...indexes];
  surface.state = applyInteractionRevision(surface.state);
  return success(action.command, action.actionId, surface, action.continuationToken, {
    ketcherSeed: seedFor(surface),
  });
}

function exportStructure(surface: RelaySurface, action: HostedKetcherAction) {
  const formats: Record<string, string> = {};
  for (const format of action.formats ?? []) {
    const value = exportFormat(surface.input, format);
    if (value === null) {
      return failure(action.command, "EXPORT_FAILED", `Hosted relay cannot export ${format} from the current representation.`, action.actionId, surface, action.continuationToken);
    }
    if (utf8ByteLength(value) > KETCHER_AGENT_LIMITS.inlineBytes) {
      return failure(action.command, "PAYLOAD_TOO_LARGE", "Inline export exceeds 64 KiB.", action.actionId, surface, action.continuationToken);
    }
    formats[format] = value;
  }
  return success(action.command, action.actionId, surface, action.continuationToken, {
    delivery: action.delivery,
    formats,
    ketcherSeed: seedFor(surface),
  });
}

function requestPersist(surface: RelaySurface, action: HostedKetcherAction) {
  return success(action.command, action.actionId, surface, action.continuationToken, {
    status: "awaiting_user",
    format: action.format,
    suggestedBasename: action.suggestedBasename,
    ketcherSeed: seedFor(surface),
  });
}

function replaySuccess(surface: RelaySurface, continuationToken: string) {
  const action = surface.lastAction!;
  if (action.command === "set_structure") {
    return success(action.command, action.actionId!, surface, continuationToken, {
      ketcherSeed: seedFor(surface),
    });
  }
  if (action.command === "clear_structure") {
    return success(action.command, action.actionId!, surface, continuationToken, { ketcherSeed: null });
  }
  if (action.command === "get_structure") {
    const formats = Object.fromEntries(
      (action.formats ?? []).map((format) => [format, exportFormat(surface.input, format) ?? ""]),
    );
    return success(action.command, action.actionId!, surface, continuationToken, {
      delivery: action.delivery,
      formats,
      ketcherSeed: seedFor(surface),
    });
  }
  if (action.command === "request_persist") {
    return success(action.command, action.actionId!, surface, continuationToken, {
      status: "awaiting_user",
      format: action.format,
      suggestedBasename: action.suggestedBasename,
      ketcherSeed: seedFor(surface),
    });
  }
  return success(action.command, action.actionId!, surface, continuationToken, {
    ketcherSeed: seedFor(surface),
  });
}

function replayState(action: HostedKetcherAction, hash: string) {
  return {
    ok: true,
    command: action.command,
    actionId: action.actionId,
    status: hash,
    ...(action.command === "get_structure" ? {
      formats: action.formats,
      delivery: action.delivery,
    } : {}),
    ...(action.command === "request_persist" ? {
      format: action.format,
      suggestedBasename: action.suggestedBasename,
    } : {}),
  };
}

function exportFormat(input: KetcherStructureInput | null, format: string) {
  if (!input?.content) return "";
  if (format === input.format) return input.content;
  if (format === "sdf" && input.format === "mol") return input.content;
  return null;
}

function structureSummary(input: KetcherStructureInput | null) {
  if (!input?.content?.trim()) return { kind: "empty" as const, atomCount: 0, bondCount: 0, componentCount: 0 };
  if (input.format === "mol") {
    const v3000 = /M\s+V30\s+COUNTS\s+(\d+)\s+(\d+)/u.exec(input.content);
    const counts = v3000 ? [Number(v3000[1]), Number(v3000[2])] : molCounts(input.content);
    return { kind: "molecule" as const, atomCount: counts[0], bondCount: counts[1], componentCount: 1 };
  }
  if (input.format === "rxn") return { kind: "reaction" as const, atomCount: 0, bondCount: 0, componentCount: 0 };
  if (input.format === "ket") {
    try {
      const value = JSON.parse(input.content) as { atoms?: unknown; bonds?: unknown };
      const atomCount = Array.isArray(value.atoms) ? value.atoms.length : value.atoms && typeof value.atoms === "object" ? Object.keys(value.atoms).length : 0;
      const bondCount = Array.isArray(value.bonds) ? value.bonds.length : value.bonds && typeof value.bonds === "object" ? Object.keys(value.bonds).length : 0;
      return { kind: atomCount > 0 ? "molecule" as const : "empty" as const, atomCount, bondCount, componentCount: atomCount > 0 ? 1 : 0 };
    } catch {
      return { kind: "empty" as const, atomCount: 0, bondCount: 0, componentCount: 0 };
    }
  }
  const atomCount = (input.content.match(/(?:\[[^\]]+\]|Br|Cl|[BCNOPSFIH])/gu) ?? []).length;
  return { kind: atomCount > 0 ? "molecule" as const : "empty" as const, atomCount, bondCount: 0, componentCount: input.content.split(".").length };
}

function molCounts(content: string) {
  const line = content.split(/\r?\n/u).find((value) => /^\s*\d+\s+\d+(?:\s+\d+){4,}\s+V2000\s*$/u.test(value));
  if (!line) return [0, 0];
  const fields = line.trim().split(/\s+/u);
  return [Number(fields[0]) || 0, Number(fields[1]) || 0];
}

function snapshot(surface: RelaySurface) {
  return createKetcherSnapshot({
    state: surface.state,
    structure: { ...structureSummary(surface.input), smiles: surface.input?.format === "smiles" ? surface.input.content : undefined },
    selectedAtoms: surface.selectedAtoms,
    highlightedAtoms: surface.highlightedAtoms,
    lastAction: surface.lastAction ? {
      ok: surface.lastAction.ok,
      command: surface.lastAction.command,
      actionId: surface.lastAction.actionId,
    } : null,
    capabilities: { setStructure: true, highlightAtoms: true, getStructure: true, persist: true },
  });
}

function seedFor(surface: RelaySurface) {
  return surface.input ? { surfaceId: surface.surfaceId, format: surface.input.format, content: surface.input.content } : null;
}

function stableActionHash(action: HostedKetcherAction) {
  const { actionId: _actionId, continuationToken: _continuationToken, ...payload } = action;
  return createHash("sha256").update(JSON.stringify(payload)).digest("base64url");
}

function refreshLifetime(surface: RelaySurface) {
  return createKetcherContinuationPayload({
    surfaceId: surface.surfaceId,
    state: surface.state,
    input: surface.input,
    selectedAtoms: surface.selectedAtoms,
    highlightedAtoms: surface.highlightedAtoms,
    lastAction: surface.lastAction,
  });
}

function success(command: string, actionId: string, surface: RelaySurface, continuationToken: string, result?: Record<string, unknown>): HostedKetcherActionResult {
  return { ok: true, command, actionId, continuationToken, ...(result ? { result } : {}), snapshot: snapshot(surface) };
}

function failure(command: string, code: KetcherAgentErrorCode, message: string, actionId?: string, surface?: RelaySurface, continuationToken?: string): HostedKetcherActionResult {
  return {
    ok: false,
    command,
    ...(actionId ? { actionId } : {}),
    ...(continuationToken ? { continuationToken } : {}),
    error: { code, message: message.slice(0, KETCHER_AGENT_LIMITS.textChars) },
    ...(surface ? { snapshot: snapshot(surface) } : {}),
  };
}

function decodeSafely(token: string) {
  try {
    return decodeKetcherContinuation(token);
  } catch (error) {
    return relayFailure(
      "TRANSPORT_UNAVAILABLE",
      error instanceof KetcherStateConfigurationError ? error.message : "Hosted Ketcher state is unavailable.",
    );
  }
}

function configurationFailure(error: unknown) {
  return relayFailure(
    "TRANSPORT_UNAVAILABLE",
    error instanceof KetcherStateConfigurationError ? error.message : "Hosted Ketcher state is unavailable.",
  );
}

function configurationActionFailure(command: string, actionId: string, error: unknown) {
  const configured = configurationFailure(error);
  return failure(command, configured.error.code, configured.error.message, actionId);
}

function relayFailure(code: KetcherAgentErrorCode, message: string) {
  return { ok: false as const, error: { code, message } };
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
