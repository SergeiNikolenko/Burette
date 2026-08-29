import { createHash, randomUUID } from "node:crypto";
import * as OCL from "openchemlib";
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
import {
  KetcherMutationCasConfigurationError,
  configuredKetcherMutationCas,
  type KetcherMutationCas,
  type KetcherMutationClaim,
} from "@/lib/ketcher-mutation-cas";

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

type ExecuteOptions = {
  cas?: KetcherMutationCas;
};

export function createHostedKetcherSurface(seed?: { format: string; content: string }) {
  const surfaceId = `hosted-ketcher:${randomUUID()}`;
  const input = seed ? normalizeStructureInput(seed) : { ok: true as const, value: undefined };
  if (!input.ok) return input;
  if (input.value?.content && utf8ByteLength(input.value.content) > MAX_HOSTED_KETCHER_INLINE_BYTES) {
    return relayFailure("PAYLOAD_TOO_LARGE", "Hosted Ketcher structure content exceeds 64 KiB.");
  }
  if (input.value) {
    const validationError = validateHostedStructure(input.value);
    if (validationError) return relayFailure("INVALID_STRUCTURE", validationError);
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

export async function executeHostedKetcherAction(
  rawAction: unknown,
  options: ExecuteOptions = {},
): Promise<HostedKetcherActionResult> {
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
  if (surface.input && action.command !== "set_structure" && action.command !== "clear_structure") {
    const validationError = validateHostedStructure(surface.input);
    if (validationError) {
      return failure(action.command, "INVALID_STRUCTURE", validationError, action.actionId, surface, continuationToken);
    }
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

  const candidate = structuredClone(surface);
  const result = action.command === "set_structure"
    ? applyStructure(candidate, action)
    : action.command === "clear_structure"
      ? clearStructure(candidate, action)
      : action.command === "highlight_atoms"
        ? applyHighlights(candidate, action)
        : action.command === "get_structure"
          ? exportStructure(candidate, action)
          : requestPersist(candidate, action);
  if (!result.ok) return { ...result, continuationToken };
  candidate.lastAction = replayState(action, actionHash);
  const refreshed = refreshLifetime(candidate);
  let nextToken: string;
  try {
    nextToken = encodeKetcherContinuation(refreshed);
  } catch (error) {
    return configurationActionFailure(action.command, action.actionId, error);
  }
  const mutationKey = stableTokenHash(continuationToken);
  const claimId = stableMutationClaim(action, actionHash);
  const ttlMs = Math.max(1, surface.expiresAt - Date.now());
  try {
    const cas = options.cas ?? configuredKetcherMutationCas();
    const claim = await cas.claim(mutationKey, claimId, ttlMs);
    if (claim.status === "exists") {
      return resolveExistingClaim(
        cas,
        claim.value,
        claimId,
        action,
        surface,
        continuationToken,
        nextToken,
        refreshed,
        result,
        ttlMs,
      );
    }
    if (!await cas.complete(mutationKey, claimId, nextToken, ttlMs)) {
      const current = await cas.read(mutationKey);
      if (current) {
        return resolveExistingClaim(
          cas,
          current,
          claimId,
          action,
          surface,
          continuationToken,
          nextToken,
          refreshed,
          result,
          ttlMs,
        );
      }
      return failure(
        action.command,
        "TRANSPORT_UNAVAILABLE",
        "Hosted Ketcher could not commit the shared mutation claim.",
        action.actionId,
      );
    }
    return { ...result, continuationToken: nextToken, snapshot: snapshot(refreshed) };
  } catch (error) {
    return casActionFailure(action.command, action.actionId, error);
  }
}

async function resolveExistingClaim(
  cas: KetcherMutationCas,
  initial: KetcherMutationClaim,
  claimId: string,
  action: HostedKetcherAction,
  surface: RelaySurface,
  continuationToken: string,
  nextToken: string,
  refreshed: RelaySurface,
  result: HostedKetcherActionResult,
  ttlMs: number,
): Promise<HostedKetcherActionResult> {
  let existing = initial;
  const mutationKey = stableTokenHash(continuationToken);
  if (existing.status === "pending" && existing.claimId === claimId) {
    if (await cas.complete(mutationKey, claimId, nextToken, ttlMs)) {
      return { ...result, continuationToken: nextToken, snapshot: snapshot(refreshed) };
    }
    existing = await cas.read(mutationKey) ?? existing;
  } else if (existing.status === "pending") {
    for (const delayMs of [5, 15, 30]) {
      await delay(delayMs);
      const current = await cas.read(mutationKey);
      if (current) existing = current;
      if (existing.status === "completed") break;
    }
  }
  if (
    existing.claimId === claimId
    && existing.status === "completed"
    && existing.continuationToken
  ) {
    const completed = decodeSafely(existing.continuationToken);
    if (completed.ok) return replaySuccess(completed.value, existing.continuationToken);
  }
  if (existing.status === "completed" && existing.continuationToken) {
    return failure(
      action.command,
      "REVISION_CONFLICT",
      "The hosted Ketcher continuation token was already consumed by another action.",
      action.actionId,
    );
  }
  if (existing.claimId === claimId) {
    return failure(
      action.command,
      "TRANSPORT_UNAVAILABLE",
      "The matching hosted Ketcher mutation is still in progress.",
      action.actionId,
      surface,
      continuationToken,
    );
  }
  return failure(
    action.command,
    "REVISION_CONFLICT",
    "The hosted Ketcher continuation token was already consumed by another action.",
    action.actionId,
  );
}

function applyStructure(surface: RelaySurface, action: HostedKetcherAction & { input?: KetcherStructureInput }) {
  if (action.input?.contentRef) {
    return failure(action.command, "TRANSPORT_UNAVAILABLE", "Hosted relay contentRef resolution is not configured.", action.actionId, surface, action.continuationToken);
  }
  if (action.input?.content && utf8ByteLength(action.input.content) > MAX_HOSTED_KETCHER_INLINE_BYTES) {
    return failure(action.command, "PAYLOAD_TOO_LARGE", "Hosted Ketcher structure content exceeds 64 KiB.", action.actionId, surface, action.continuationToken);
  }
  if (action.input) {
    const validationError = validateHostedStructure(action.input);
    if (validationError) {
      return failure(action.command, "INVALID_STRUCTURE", validationError, action.actionId, surface, action.continuationToken);
    }
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
  if (action.delivery !== "inline") {
    return failure(
      action.command,
      "EXPORT_FAILED",
      "Hosted relay supports inline export delivery only.",
      action.actionId,
      surface,
      action.continuationToken,
    );
  }
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
  surface.state = applyInteractionRevision(surface.state);
  return success(action.command, action.actionId, surface, action.continuationToken, {
    delivery: action.delivery,
    formats,
    ketcherSeed: seedFor(surface),
  });
}

function requestPersist(surface: RelaySurface, action: HostedKetcherAction) {
  surface.state = applyInteractionRevision(surface.state);
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
  if (format === "sdf" && input.format === "mol") {
    return `${input.content.replace(/\s+$/u, "")}\n$$$$\n`;
  }
  return null;
}

function structureSummary(input: KetcherStructureInput | null) {
  if (!input?.content?.trim()) return { kind: "empty" as const, atomCount: 0, bondCount: 0, componentCount: 0 };
  if (input.format === "mol") {
    try {
      const molecule = OCL.Molecule.fromMolfile(input.content);
      return {
        kind: "molecule" as const,
        atomCount: molecule.getAllAtoms(),
        bondCount: molecule.getAllBonds(),
        componentCount: molecule.getAllAtoms() > 0 ? 1 : 0,
      };
    } catch {
      return { kind: "empty" as const, atomCount: 0, bondCount: 0, componentCount: 0 };
    }
  }
  if (input.format === "rxn") return { kind: "reaction" as const, atomCount: 0, bondCount: 0, componentCount: 0 };
  if (input.format === "ket") {
    return ketSummary(input.content);
  }
  return smilesSummary(input.content);
}

function validateHostedStructure(input: KetcherStructureInput) {
  if (!input.content?.trim()) return null;
  try {
    if (input.format === "smiles") {
      const smiles = input.content.trim();
      if (!hasStrictSmilesSyntax(smiles)) throw new Error("Invalid SMILES syntax.");
      if (OCL.Molecule.fromSmiles(smiles, { noCoordinates: true, noStereo: true }).getAllAtoms() === 0) {
        throw new Error("SMILES contains no atoms.");
      }
    }
    if (input.format === "mol") {
      if (!hasExactMolFraming(input.content)) throw new Error("Invalid MOL framing.");
      if (OCL.Molecule.fromMolfile(input.content).getAllAtoms() === 0) throw new Error("MOL contains no atoms.");
    }
    if (input.format === "rxn") {
      if (!hasExactRxnFraming(input.content)) throw new Error("Invalid RXN framing.");
      if (OCL.Reaction.fromRxn(input.content).isEmpty()) throw new Error("RXN contains no structures.");
    }
    if (input.format === "ket") {
      const value: unknown = JSON.parse(input.content);
      if (!isValidKet(value)) throw new Error("Invalid KET structure.");
    }
    return null;
  } catch {
    return `Hosted Ketcher received invalid ${input.format.toUpperCase()} structure content.`;
  }
}

function normalizedStructureLines(content: string) {
  return content.trimEnd().split(/\r?\n/u);
}

function hasExactMolFraming(content: string) {
  const lines = normalizedStructureLines(content);
  if (lines.at(-1) !== "M  END" || lines.filter((line) => line === "M  END").length !== 1) return false;
  if (lines[3]?.trimEnd().endsWith("V3000")) {
    return hasExactV3000Ctab(lines.slice(4, -1));
  }
  const counts = /^\s*(\d+)\s+(\d+).*V2000\s*$/u.exec(lines[3] ?? "");
  if (!counts) return false;
  const structuralEnd = 4 + Number(counts[1]) + Number(counts[2]);
  if (structuralEnd > lines.length - 1) return false;
  for (let index = structuralEnd; index < lines.length - 1; index += 1) {
    const line = lines[index];
    const property = /^M  ([A-Z0-9]{3})(?:\s.*)?$/u.exec(line);
    if (property && new Set([
      "AAL", "ALS", "APO", "CHG", "CRS", "ISO", "LIN", "RBC", "RAD", "RGP", "SAL", "SAP",
      "SBL", "SBT", "SCL", "SCN", "SDS", "SED", "SLB", "SMT", "SNC", "SPA", "SPL", "SST",
      "STY", "SUB", "UNS",
    ]).has(property[1])) continue;
    if (/^V  \s*\d+\s+.+$/u.test(line)) continue;
    if (/^[AG]  \s*\d+\s*$/u.test(line)) {
      index += 1;
      if (index >= lines.length - 1) return false;
      continue;
    }
    return false;
  }
  return true;
}

function hasExactV3000Ctab(records: string[]) {
  if (records[0] !== "M  V30 BEGIN CTAB" || records.at(-1) !== "M  V30 END CTAB") return false;
  let section: string | null = null;
  let atomCount = -1;
  let bondCount = -1;
  let atomRecords = 0;
  let bondRecords = 0;
  let countsSeen = false;
  for (const line of records.slice(1, -1)) {
    const counts = /^M  V30 COUNTS\s+(\d+)\s+(\d+)(?:\s+\d+){3}\s*$/u.exec(line);
    if (counts) {
      if (section || countsSeen) return false;
      countsSeen = true;
      atomCount = Number(counts[1]);
      bondCount = Number(counts[2]);
      continue;
    }
    const begin = /^M  V30 BEGIN (ATOM|BOND|SGROUP|COLLECTION)$/u.exec(line);
    if (begin) {
      if (section) return false;
      section = begin[1];
      continue;
    }
    const end = /^M  V30 END (ATOM|BOND|SGROUP|COLLECTION)$/u.exec(line);
    if (end) {
      if (section !== end[1]) return false;
      section = null;
      continue;
    }
    if (!section || !/^M  V30 \d+\s+/u.test(line)) return false;
    if (section === "ATOM") atomRecords += 1;
    if (section === "BOND") bondRecords += 1;
  }
  return section === null && countsSeen && atomRecords === atomCount && bondRecords === bondCount;
}

function hasExactRxnFraming(content: string) {
  const lines = normalizedStructureLines(content);
  if (lines[0] === "$RXN V3000") {
    const counts = lines.map((line) => /^M  V30 COUNTS\s+(\d+)\s+(\d+)\s*$/u.exec(line)).find(Boolean);
    if (!counts) return false;
    const structureCount = Number(counts[1]) + Number(counts[2]);
    if (structureCount === 0 || lines.at(-1) !== "M  END" || lines.filter((line) => line === "M  END").length !== 1) return false;
    const records = lines.slice(5, -1);
    let group: "REACTANT" | "PRODUCT" | "AGENT" | null = null;
    let ctabCount = 0;
    for (let index = 0; index < records.length; index += 1) {
      const begin = /^M  V30 BEGIN (REACTANT|PRODUCT|AGENT)$/u.exec(records[index]);
      if (begin) {
        if (group) return false;
        group = begin[1] as "REACTANT" | "PRODUCT" | "AGENT";
        continue;
      }
      const end = /^M  V30 END (REACTANT|PRODUCT|AGENT)$/u.exec(records[index]);
      if (end) {
        if (group !== end[1]) return false;
        group = null;
        continue;
      }
      if (records[index] === "M  V30 BEGIN CTAB" && group) {
        const endIndex = records.indexOf("M  V30 END CTAB", index + 1);
        if (endIndex < 0 || !hasExactV3000Ctab(records.slice(index, endIndex + 1))) return false;
        ctabCount += 1;
        index = endIndex;
        continue;
      }
      return false;
    }
    return group === null && ctabCount === structureCount;
  }
  if (lines[0] !== "$RXN") return false;
  const counts = /^\s*(\d+)\s+(\d+)(?:\s+\d+)?\s*$/u.exec(lines[4] ?? "");
  if (!counts) return false;
  const structureCount = Number(counts[1]) + Number(counts[2]);
  const molStarts = lines.flatMap((line, index) => line === "$MOL" ? [index] : []);
  if (structureCount === 0 || molStarts.length !== structureCount) return false;
  return molStarts.every((start, index) => {
    const end = molStarts[index + 1] ?? lines.length;
    const block = lines.slice(start + 1, end);
    return hasExactMolFraming(block.join("\n"));
  });
}

function hasStrictSmilesSyntax(content: string) {
  const branches: boolean[] = [];
  const rings = new Set<string>();
  let last: "start" | "atom" | "bond" | "open" | "close" | "ring" | "dot" = "start";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    let atomLength = 0;
    if (char === "[") {
      const end = content.indexOf("]", index + 1);
      if (end <= index + 1 || !/^[\x20-\x7e]+$/u.test(content.slice(index + 1, end))) return false;
      atomLength = end - index + 1;
    } else {
      const pair = content.slice(index, index + 2);
      if (pair === "Br" || pair === "Cl" || pair === "as" || pair === "se") atomLength = 2;
      else if (/[BCNOPSFIbcnops*]/u.test(char)) atomLength = 1;
    }
    if (atomLength > 0) {
      if (branches.length > 0) branches[branches.length - 1] = true;
      last = "atom";
      index += atomLength - 1;
      continue;
    }
    const afterStructure = last === "atom" || last === "ring" || last === "close";
    if (char === "(") {
      if (!afterStructure) return false;
      branches.push(false);
      last = "open";
      continue;
    }
    if (char === ")") {
      if (branches.pop() !== true || !afterStructure) return false;
      last = "close";
      continue;
    }
    if (char === ".") {
      if (branches.length > 0 || rings.size > 0 || !afterStructure) return false;
      last = "dot";
      continue;
    }
    if (/[-=#$:/\\]/u.test(char)) {
      if (!afterStructure && last !== "open") return false;
      last = "bond";
      continue;
    }
    let ring = "";
    if (/\d/u.test(char)) ring = char;
    else if (char === "%" && /^\d{2}$/u.test(content.slice(index + 1, index + 3))) {
      ring = content.slice(index + 1, index + 3);
      index += 2;
    } else if (char === "%" && /^\(\d{3,}\)/u.test(content.slice(index + 1))) {
      const match = /^\((\d{3,})\)/u.exec(content.slice(index + 1));
      if (!match) return false;
      ring = match[1];
      index += match[0].length;
    } else {
      return false;
    }
    if (!afterStructure && last !== "bond") return false;
    if (rings.has(ring)) rings.delete(ring);
    else rings.add(ring);
    last = "ring";
  }
  return branches.length === 0
    && rings.size === 0
    && (last === "atom" || last === "ring" || last === "close");
}

function isValidKet(value: unknown) {
  if (!isRecord(value) || !isRecord(value.root) || !Array.isArray(value.root.nodes)) return false;
  const supportedNodeTypes = new Set([
    "ambiguousMonomerTemplate",
    "ambiguousMonomer",
    "arrow",
    "image",
    "molecule",
    "monomer",
    "monomerTemplate",
    "multi-tailed-arrow",
    "plus",
    "rgroup",
    "simpleObject",
    "text",
  ]);
  for (const node of value.root.nodes) {
    const candidate = isRecord(node) && typeof node.$ref === "string"
      ? Object.hasOwn(value, node.$ref) ? value[node.$ref] : undefined
      : node;
    if (!isRecord(candidate) || !supportedNodeTypes.has(String(candidate.type))) return false;
    if (candidate.type !== "molecule") continue;
    if (!Array.isArray(candidate.atoms) || !candidate.atoms.every((atom) =>
      isRecord(atom) && typeof atom.label === "string" && atom.label.length > 0
    )) return false;
    const atomCount = candidate.atoms.length;
    if (candidate.bonds !== undefined && !Array.isArray(candidate.bonds)) return false;
    if (Array.isArray(candidate.bonds) && !candidate.bonds.every((bond) =>
      isRecord(bond)
      && Array.isArray(bond.atoms)
      && bond.atoms.length === 2
      && bond.atoms[0] !== bond.atoms[1]
      && bond.atoms.every((atom) => Number.isSafeInteger(atom) && atom >= 0 && atom < atomCount)
    )) return false;
  }
  return true;
}

function ketSummary(content: string) {
  const empty = { kind: "empty" as const, atomCount: 0, bondCount: 0, componentCount: 0 };
  try {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) return empty;
    let atomCount = 0;
    let bondCount = 0;
    let componentCount = 0;
    const seen = new Set<Record<string, unknown>>();
    const addMolecule = (candidate: unknown) => {
      if (!isRecord(candidate) || !Array.isArray(candidate.atoms) || seen.has(candidate)) return;
      seen.add(candidate);
      atomCount += candidate.atoms.length;
      bondCount += Array.isArray(candidate.bonds) ? candidate.bonds.length : 0;
      if (candidate.atoms.length > 0) componentCount += 1;
    };
    const root = isRecord(value.root) ? value.root : null;
    if (Array.isArray(root?.nodes)) {
      for (const node of root.nodes) {
        if (isRecord(node) && typeof node.$ref === "string") {
          addMolecule(Object.hasOwn(value, node.$ref) ? value[node.$ref] : undefined);
        }
        else addMolecule(node);
      }
    }
    if (seen.size === 0) {
      addMolecule(value);
      for (const [key, candidate] of Object.entries(value)) {
        if (key !== "root" && isRecord(candidate) && candidate.type === "molecule") addMolecule(candidate);
      }
    }
    return {
      kind: atomCount > 0 ? "molecule" as const : "empty" as const,
      atomCount,
      bondCount,
      componentCount,
    };
  } catch {
    return empty;
  }
}

function smilesSummary(content: string) {
  try {
    const molecule = OCL.Molecule.fromSmiles(content, { noCoordinates: true, noStereo: true });
    const atomCount = molecule.getAllAtoms();
    return {
      kind: atomCount > 0 ? "molecule" as const : "empty" as const,
      atomCount,
      bondCount: molecule.getAllBonds(),
      componentCount: molecule.getFragments().length,
    };
  } catch {
    return { kind: "empty" as const, atomCount: 0, bondCount: 0, componentCount: 0 };
  }
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

function stableMutationClaim(action: HostedKetcherAction, actionHash: string) {
  return createHash("sha256")
    .update(action.actionId)
    .update("\0")
    .update(actionHash)
    .digest("base64url");
}

function stableTokenHash(continuationToken: string) {
  return createHash("sha256").update(continuationToken).digest("base64url");
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

function casActionFailure(command: string, actionId: string, error: unknown) {
  return failure(
    command,
    "TRANSPORT_UNAVAILABLE",
    error instanceof KetcherMutationCasConfigurationError
      ? error.message
      : "Hosted Ketcher shared mutation state is unavailable.",
    actionId,
  );
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

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
