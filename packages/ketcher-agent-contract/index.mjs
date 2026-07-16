export const KETCHER_AGENT_API_VERSION = "burrete-ketcher-agent/v1";

export const KETCHER_AGENT_LIMITS = Object.freeze({
  inlineBytes: 64 * 1024,
  referencedStructureBytes: 1024 * 1024,
  smilesChars: 500,
  reactionSmilesChars: 1000,
  atomIndexes: 256,
  textChars: 255,
});

export const KETCHER_AGENT_ERROR_CODES = Object.freeze([
  "NOT_READY",
  "INVALID_INPUT",
  "INVALID_STRUCTURE",
  "UNSUPPORTED_FORMAT",
  "PAYLOAD_TOO_LARGE",
  "STALE_TARGET",
  "REVISION_CONFLICT",
  "INVALID_ATOM_INDEX",
  "REPLAY_CONFLICT",
  "TIMEOUT",
  "OUTCOME_UNKNOWN",
  "RECOVERY_FAILED",
  "EXPORT_FAILED",
  "PERSIST_CANCELLED",
  "TRANSPORT_UNAVAILABLE",
]);

const COMMANDS = new Set([
  "set_structure",
  "clear_structure",
  "highlight_atoms",
  "get_structure",
  "request_persist",
]);
const INPUT_FORMATS = new Set(["ket", "mol", "rxn", "smiles"]);
const OUTPUT_FORMATS = new Set(["ket", "mol", "rxn", "sdf", "smiles", "reaction_smiles", "cdxml"]);
const DELIVERIES = new Set(["inline", "artifact", "download"]);
const BASE_ACTION_KEYS = new Set(["apiVersion", "type", "command", "surfaceId", "actionId", "expectedRevision"]);

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function boundedText(value, max = KETCHER_AGENT_LIMITS.textChars) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeIndexes(value) {
  if (!Array.isArray(value) || value.length > KETCHER_AGENT_LIMITS.atomIndexes) return null;
  const indexes = value.map((item) => item);
  if (!indexes.every((item) => Number.isSafeInteger(item) && item >= 0)) return null;
  const unique = new Set(indexes);
  if (unique.size !== indexes.length) return null;
  return [...unique].sort((left, right) => left - right);
}

export function normalizeStructureInput(input) {
  if (!isRecord(input)) return failure("INVALID_INPUT", "Structure input must be an object.");
  const keys = Object.keys(input);
  if (keys.some((key) => !["format", "content", "contentRef"].includes(key))) {
    return failure("INVALID_INPUT", "Structure input contains an unknown field.");
  }
  const format = typeof input.format === "string" ? input.format.trim().toLowerCase() : "";
  if (!INPUT_FORMATS.has(format)) return failure("UNSUPPORTED_FORMAT", "Structure format is unsupported.");
  const hasContent = typeof input.content === "string";
  const hasReference = typeof input.contentRef === "string" && input.contentRef.trim().length > 0;
  if (hasContent === hasReference) {
    return failure("INVALID_INPUT", "Provide exactly one inline content or contentRef.");
  }
  if (hasContent && utf8ByteLength(input.content) > KETCHER_AGENT_LIMITS.inlineBytes) {
    return failure("PAYLOAD_TOO_LARGE", "Inline structure content exceeds 64 KiB.");
  }
  if (hasReference && format === "smiles") {
    return failure("INVALID_INPUT", "Referenced SMILES content is not supported.");
  }
  return success({
    format,
    ...(hasContent ? { content: input.content } : { contentRef: input.contentRef.trim() }),
  });
}

export function validateKetcherAction(action) {
  if (!isRecord(action)) return failure("INVALID_INPUT", "Ketcher action must be an object.");
  if (action.type !== "control_ketcher" || !COMMANDS.has(action.command)) {
    return failure("INVALID_INPUT", "Ketcher action type or command is invalid.");
  }
  if (action.apiVersion !== undefined && action.apiVersion !== KETCHER_AGENT_API_VERSION) {
    return failure("INVALID_INPUT", "Ketcher action apiVersion is unsupported.");
  }
  const base = [...BASE_ACTION_KEYS];
  const extras = action.command === "set_structure"
    ? ["format", "content", "contentRef"]
    : action.command === "highlight_atoms"
      ? ["indexes"]
      : action.command === "get_structure"
        ? ["formats", "delivery"]
        : action.command === "request_persist"
          ? ["format", "suggestedBasename"]
          : [];
  const allowed = new Set([...base, ...extras]);
  if (Object.keys(action).some((key) => !allowed.has(key))) {
    return failure("INVALID_INPUT", "Ketcher action contains an unknown field.");
  }
  if (typeof action.surfaceId !== "string" || !action.surfaceId.trim()) {
    return failure("INVALID_INPUT", "surfaceId is required.");
  }
  if (typeof action.actionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(action.actionId)) {
    return failure("INVALID_INPUT", "actionId must be a bounded identifier.");
  }
  if (!Number.isSafeInteger(action.expectedRevision) || action.expectedRevision < 0) {
    return failure("INVALID_INPUT", "expectedRevision must be a non-negative integer.");
  }
  if (action.command === "set_structure") {
    const input = normalizeStructureInput({
      format: action.format,
      ...(Object.hasOwn(action, "content") ? { content: action.content } : {}),
      ...(Object.hasOwn(action, "contentRef") ? { contentRef: action.contentRef } : {}),
    });
    if (!input.ok) return input;
    return success({ ...action, input: input.value });
  }
  if (action.command === "highlight_atoms") {
    const indexes = normalizeIndexes(action.indexes);
    if (!indexes) return failure("INVALID_ATOM_INDEX", "indexes must be unique, sorted-able atom indexes up to 256 items.");
    return success({ ...action, indexes });
  }
  if (action.command === "get_structure") {
    if (!Array.isArray(action.formats) || action.formats.length === 0 || action.formats.length > 7) {
      return failure("INVALID_INPUT", "formats must contain one to seven output formats.");
    }
    const formats = [...new Set(action.formats.map((format) => typeof format === "string" ? format.trim().toLowerCase() : ""))];
    if (!formats.every((format) => OUTPUT_FORMATS.has(format))) return failure("UNSUPPORTED_FORMAT", "An output format is unsupported.");
    const delivery = action.delivery ?? "inline";
    if (!DELIVERIES.has(delivery)) return failure("INVALID_INPUT", "delivery must be inline, artifact, or download.");
    return success({ ...action, formats, delivery });
  }
  if (action.command === "request_persist") {
    const format = typeof action.format === "string" ? action.format.trim().toLowerCase() : "";
    const suggestedBasename = typeof action.suggestedBasename === "string" ? action.suggestedBasename.trim() : "ketcher-structure";
    if (!OUTPUT_FORMATS.has(format)) return failure("UNSUPPORTED_FORMAT", "The persistence format is unsupported.");
    if (!suggestedBasename || suggestedBasename.length > KETCHER_AGENT_LIMITS.textChars || /[\\/:*?"<>|\u0000-\u001f]/u.test(suggestedBasename)) {
      return failure("INVALID_INPUT", "suggestedBasename is not a safe filename.");
    }
    return success({ ...action, format, suggestedBasename });
  }
  return success({ ...action });
}

export function createRevisionState(surfaceId, phase = "loading") {
  return {
    surfaceId,
    phase,
    structureRevision: 0,
    interactionRevision: 0,
    persistedRevision: 0,
    dirty: false,
  };
}

export function applyStructuralRevision(state) {
  const structureRevision = state.structureRevision + 1;
  return {
    ...state,
    structureRevision,
    interactionRevision: state.interactionRevision + 1,
    dirty: structureRevision !== state.persistedRevision,
  };
}

export function applyInteractionRevision(state) {
  return { ...state, interactionRevision: state.interactionRevision + 1 };
}

export function markPersisted(state, revision = state.structureRevision) {
  if (!Number.isSafeInteger(revision) || revision !== state.structureRevision) return state;
  return { ...state, persistedRevision: revision, dirty: false };
}

export function createKetcherSnapshot({
  state,
  structure = {},
  selectedAtoms = [],
  highlightedAtoms = [],
  lastAction = null,
  capabilities = {},
}) {
  const selection = boundedIndexState(selectedAtoms);
  const highlights = boundedIndexState(highlightedAtoms);
  return {
    apiVersion: KETCHER_AGENT_API_VERSION,
    surfaceId: state.surfaceId,
    phase: state.phase,
    structureRevision: state.structureRevision,
    interactionRevision: state.interactionRevision,
    persistedRevision: state.persistedRevision,
    dirty: state.dirty,
    structure: {
      kind: structure.kind === "reaction" || structure.kind === "molecule" ? structure.kind : "empty",
      atomCount: safeCount(structure.atomCount),
      bondCount: safeCount(structure.bondCount),
      componentCount: safeCount(structure.componentCount),
      smiles: boundedOptional(structure.smiles, KETCHER_AGENT_LIMITS.smilesChars),
      reactionSmiles: boundedOptional(structure.reactionSmiles, KETCHER_AGENT_LIMITS.reactionSmilesChars),
      smilesOmitted: omissionFlag(structure.smiles, KETCHER_AGENT_LIMITS.smilesChars),
      reactionSmilesOmitted: omissionFlag(structure.reactionSmiles, KETCHER_AGENT_LIMITS.reactionSmilesChars),
    },
    selectedAtoms: selection.indexes,
    selectedAtomCount: selection.total,
    selectionTruncated: selection.truncated,
    highlightedAtoms: highlights.indexes,
    highlightedAtomCount: highlights.total,
    highlightTruncated: highlights.truncated,
    lastAction,
    capabilities: {
      setStructure: capabilities.setStructure === true,
      highlightAtoms: capabilities.highlightAtoms === true,
      getStructure: capabilities.getStructure === true,
      persist: capabilities.persist === true,
    },
  };
}

function boundedIndexState(value) {
  const indexes = Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && item >= 0)
    ? [...new Set(value)].sort((left, right) => left - right)
    : [];
  return {
    indexes: indexes.slice(0, KETCHER_AGENT_LIMITS.atomIndexes),
    total: indexes.length,
    truncated: indexes.length > KETCHER_AGENT_LIMITS.atomIndexes,
  };
}

function boundedOptional(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) return null;
  return value;
}

function omissionFlag(value, max) {
  return typeof value === "string" && value.trim().length > max;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message: boundedText(message) } };
}
