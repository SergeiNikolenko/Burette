import { randomUUID } from "node:crypto";
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
} from "@burrete/ketcher-agent-contract";

type RelaySurface = {
  surfaceId: string;
  updatedAt: number;
  state: ReturnType<typeof createRevisionState>;
  input: KetcherStructureInput | null;
  selectedAtoms: number[];
  highlightedAtoms: number[];
  lastAction: unknown;
  actionResults: Map<string, { hash: string; result: HostedKetcherActionResult }>;
};

export type HostedKetcherActionResult = {
  ok: boolean;
  command: string;
  actionId?: string;
  result?: Record<string, unknown>;
  snapshot?: KetcherSnapshot;
  error?: { code: KetcherAgentErrorCode; message: string };
};

const surfaces = new Map<string, RelaySurface>();
const RELAY_TTL_MS = 15 * 60 * 1000;
const MAX_SURFACES = 256;

export function createHostedKetcherSurface(seed?: { format: string; content: string }) {
  pruneExpiredSurfaces();
  while (surfaces.size >= MAX_SURFACES) {
    const oldest = [...surfaces.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
    if (!oldest) break;
    surfaces.delete(oldest.surfaceId);
  }
  const surfaceId = `hosted-ketcher:${randomUUID()}`;
  const input = seed ? normalizeStructureInput(seed) : { ok: true as const, value: undefined };
  if (!input.ok) return input;
  const surface: RelaySurface = {
    surfaceId,
    updatedAt: Date.now(),
    state: createRevisionState(surfaceId, "ready"),
    input: input.value ?? null,
    selectedAtoms: [],
    highlightedAtoms: [],
    lastAction: null,
    actionResults: new Map(),
  };
  if (surface.input) surface.state = markPersisted(applyStructuralRevision(surface.state));
  surfaces.set(surfaceId, surface);
  return { ok: true as const, surface };
}

export function hostedKetcherSnapshot(surfaceId: string) {
  pruneExpiredSurfaces();
  const surface = surfaces.get(surfaceId);
  if (surface) surface.updatedAt = Date.now();
  return surface ? snapshot(surface) : null;
}

export function executeHostedKetcherAction(rawAction: unknown): HostedKetcherActionResult {
  pruneExpiredSurfaces();
  const validated = validateKetcherAction(rawAction);
  if (!validated.ok) return failure("control_ketcher", validated.error.code, validated.error.message);
  const action = validated.value;
  const surface = surfaces.get(action.surfaceId);
  if (!surface) return failure(action.command, "STALE_TARGET", "The hosted Ketcher surface is no longer available.", action.actionId);
  surface.updatedAt = Date.now();
  const actionHash = stableActionHash(action);
  const previous = surface.actionResults.get(action.actionId);
  if (previous) {
    if (previous.hash !== actionHash) return failure(action.command, "REPLAY_CONFLICT", "actionId was already used for another payload.", action.actionId, surface);
    return previous.result;
  }
  if (surface.state.phase !== "ready") return remember(surface, action, failure(action.command, "NOT_READY", "The hosted Ketcher surface is not ready.", action.actionId, surface), actionHash);
  if (action.expectedRevision !== surface.state.structureRevision) {
    return remember(surface, action, failure(action.command, "REVISION_CONFLICT", "The hosted Ketcher structure revision is stale.", action.actionId, surface), actionHash);
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
  return remember(surface, action, result, actionHash);
}

function applyStructure(surface: RelaySurface, action: KetcherControlAction & { input?: KetcherStructureInput }) {
  if (action.input?.contentRef) return failure(action.command, "TRANSPORT_UNAVAILABLE", "Hosted relay contentRef resolution is not configured.", action.actionId, surface);
  surface.input = action.input ?? null;
  surface.selectedAtoms = [];
  surface.highlightedAtoms = [];
  surface.state = applyStructuralRevision(surface.state);
  surface.lastAction = { ok: true, command: action.command, actionId: action.actionId };
  return success(action.command, action.actionId, surface, {
    ketcherSeed: seedFor(surface),
  });
}

function clearStructure(surface: RelaySurface, action: KetcherControlAction) {
  surface.input = null;
  surface.selectedAtoms = [];
  surface.highlightedAtoms = [];
  surface.state = applyStructuralRevision(surface.state);
  surface.lastAction = { ok: true, command: action.command, actionId: action.actionId };
  return success(action.command, action.actionId, surface, { ketcherSeed: null });
}

function applyHighlights(surface: RelaySurface, action: KetcherControlAction) {
  const indexes = action.indexes ?? [];
  const atomCount = structureSummary(surface.input).atomCount;
  if (indexes.some((index) => index >= atomCount)) {
    return failure(action.command, "INVALID_ATOM_INDEX", "An atom index is outside the current structure.", action.actionId, surface);
  }
  surface.highlightedAtoms = [...indexes];
  surface.state = applyInteractionRevision(surface.state);
  surface.lastAction = { ok: true, command: action.command, actionId: action.actionId };
  return success(action.command, action.actionId, surface);
}

function exportStructure(surface: RelaySurface, action: KetcherControlAction) {
  const formats: Record<string, string> = {};
  for (const format of action.formats ?? []) {
    const value = exportFormat(surface.input, format);
    if (value === null) return failure(action.command, "EXPORT_FAILED", `Hosted relay cannot export ${format} from the current representation.`, action.actionId, surface);
    if (new TextEncoder().encode(value).byteLength > KETCHER_AGENT_LIMITS.inlineBytes) {
      return failure(action.command, "PAYLOAD_TOO_LARGE", "Inline export exceeds 64 KiB.", action.actionId, surface);
    }
    formats[format] = value;
  }
  surface.lastAction = { ok: true, command: action.command, actionId: action.actionId };
  return success(action.command, action.actionId, surface, { delivery: action.delivery, formats });
}

function requestPersist(surface: RelaySurface, action: KetcherControlAction) {
  surface.lastAction = { ok: true, command: action.command, actionId: action.actionId, status: "awaiting_user" };
  return success(action.command, action.actionId, surface, {
    status: "awaiting_user",
    format: action.format,
    suggestedBasename: action.suggestedBasename,
  });
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
    lastAction: surface.lastAction,
    capabilities: { setStructure: true, highlightAtoms: true, getStructure: true, persist: true },
  });
}

function seedFor(surface: RelaySurface) {
  return surface.input ? { surfaceId: surface.surfaceId, format: surface.input.format, content: surface.input.content } : null;
}

function stableActionHash(action: KetcherControlAction) {
  const { actionId: _actionId, ...payload } = action;
  return JSON.stringify(payload);
}

function remember(surface: RelaySurface, action: KetcherControlAction, result: HostedKetcherActionResult, hash: string) {
  surface.actionResults.set(action.actionId, { hash, result });
  while (surface.actionResults.size > 256) {
    const oldest = surface.actionResults.keys().next().value;
    if (!oldest) break;
    surface.actionResults.delete(oldest);
  }
  return result;
}

function pruneExpiredSurfaces() {
  const cutoff = Date.now() - RELAY_TTL_MS;
  for (const [surfaceId, surface] of surfaces) {
    if (surface.updatedAt < cutoff) surfaces.delete(surfaceId);
  }
}

function success(command: string, actionId: string, surface: RelaySurface, result?: Record<string, unknown>): HostedKetcherActionResult {
  return { ok: true, command, actionId, ...(result ? { result } : {}), snapshot: snapshot(surface) };
}

function failure(command: string, code: KetcherAgentErrorCode, message: string, actionId?: string, surface?: RelaySurface): HostedKetcherActionResult {
  return {
    ok: false,
    command,
    ...(actionId ? { actionId } : {}),
    error: { code, message: message.slice(0, KETCHER_AGENT_LIMITS.textChars) },
    ...(surface ? { snapshot: snapshot(surface) } : {}),
  };
}
