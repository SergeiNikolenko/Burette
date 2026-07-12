const MAX_ITEMS = 96;
const MAX_TEXT = 255;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? value as UnknownRecord : null;
}

function bounded(value: unknown, fallback = ""): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, MAX_TEXT);
}

function boundedSource(value: unknown) {
  const source = record(value);
  if (source?.kind === "pdb") {
    return { kind: "pdb", pdbId: bounded(source.pdbId).slice(0, 4) };
  }
  if (source?.kind === "attachment") {
    return { kind: "attachment", fileName: bounded(source.fileName) };
  }
  return null;
}

const SELECTOR_STRING_KEYS = new Set([
  "kind", "auth_asym_id", "label_asym_id", "auth_comp_id", "label_comp_id",
]);
const SELECTOR_NUMBER_KEYS = new Set([
  "auth_seq_id", "label_seq_id", "beg_auth_seq_id", "end_auth_seq_id",
  "beg_label_seq_id", "end_label_seq_id",
]);
const SELECTOR_KINDS = new Set(["all", "polymer", "protein", "nucleic", "ligand", "ion", "water"]);
const COMPONENT_KINDS = new Set(["polymer", "ligand", "ion", "water"]);

function sanitizedSelector(value: unknown) {
  const selector = record(value);
  if (!selector) return null;
  const keys = Object.keys(selector);
  if (keys.some((key) => !SELECTOR_STRING_KEYS.has(key) && !SELECTOR_NUMBER_KEYS.has(key))) return null;
  const out: UnknownRecord = {};
  for (const key of keys) {
    const field = selector[key];
    if (SELECTOR_STRING_KEYS.has(key)) {
      const text = bounded(field);
      if (!text || (key === "kind" && !SELECTOR_KINDS.has(text))) return null;
      out[key] = text;
    } else {
      const number = Number(field);
      if (!Number.isSafeInteger(number)) return null;
      out[key] = number;
    }
  }
  return out;
}

export function sanitizeViewerActions(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  const actions: UnknownRecord[] = [];
  for (const item of value.slice(0, 8)) {
    const action = record(item);
    const type = typeof action?.type === "string" ? action.type : "";
    if ((type === "clear_selection" || type === "reset_camera") && Object.keys(action ?? {}).length === 1) {
      actions.push({ type });
      continue;
    }
    if (type === "hide_components" || type === "show_components") {
      if (Object.keys(action ?? {}).some((key) => key !== "type" && key !== "kind")) continue;
      const kind = typeof action?.kind === "string" ? action.kind : "";
      if (COMPONENT_KINDS.has(kind)) actions.push({ type, kind });
      continue;
    }
    if (type === "select_residues") {
      if (Object.keys(action ?? {}).some((key) => !["type", "selector", "mode", "granularity", "label"].includes(key))) continue;
      const selector = sanitizedSelector(action?.selector);
      const granularity = action?.granularity;
      if (
        !selector
        || (action?.mode != null && action.mode !== "replace")
        || (granularity != null && !["atom", "residue", "chain"].includes(String(granularity)))
      ) continue;
      actions.push({
        type,
        selector,
        mode: "replace",
        ...(granularity == null ? {} : { granularity: String(granularity) }),
        ...(typeof action?.label === "string" ? { label: bounded(action.label).slice(0, 128) } : {}),
      });
      continue;
    }
    if (type === "focus_selection") {
      if (Object.keys(action ?? {}).some((key) => key !== "type" && key !== "selector")) continue;
      const selector = action?.selector == null ? undefined : sanitizedSelector(action.selector);
      if (action?.selector != null && !selector) continue;
      actions.push({ type, ...(selector ? { selector } : {}) });
    }
  }
  return actions;
}

function boundedIdentity(value: unknown) {
  const atom = record(value) ?? {};
  return {
    chain: bounded(atom.chain),
    sequence: typeof atom.sequence === "number"
      ? atom.sequence
      : typeof atom.sequence === "string"
        ? bounded(atom.sequence)
        : null,
    compId: bounded(atom.compId),
    atomName: bounded(atom.atomName),
  };
}

export function createSelectionContext(value: unknown, documentId: string, source?: unknown) {
  const selection = record(value);
  const sourceDescriptor = boundedSource(source);
  if (!selection || selection.cleared === true) {
    return {
      content: [{ type: "text" as const, text: "The active Burrete molecular selection is empty." }],
      structuredContent: { burrete: { source: sourceDescriptor, activeSelection: null } },
    };
  }
  const residues = Array.isArray(selection.residues)
    ? selection.residues.slice(0, MAX_ITEMS).map(boundedIdentity).map(({ atomName: _, ...residue }) => residue)
    : [];
  const atomIdentities = Array.isArray(selection.atomIdentities)
    ? selection.atomIdentities.slice(0, MAX_ITEMS).map(boundedIdentity)
    : [];
  const atoms = Math.max(0, Math.trunc(Number(selection.atoms) || atomIdentities.length));
  const label = bounded(selection.label, `Selection with ${atoms} visible atoms across ${residues.length} residues`);
  return {
    content: [{
      type: "text" as const,
      text: `Current Burrete selection: ${label}. Treat this as the user's active molecular selection for their next request.`,
    }],
    structuredContent: {
      burrete: {
        source: sourceDescriptor,
        activeSelection: {
          source: bounded(selection.source, "viewer"),
          documentId: bounded(documentId, "active-structure"),
          label,
          atoms,
          residueCount: Math.max(0, Math.trunc(Number(selection.residueCount) || residues.length)),
          visibleTargets: Math.max(0, Math.trunc(Number(selection.visibleTargets) || 0)),
          residues,
          atomIdentities,
        },
      },
    },
  };
}

export function createSceneContext(value: unknown, source?: unknown) {
  const report = record(value) ?? {};
  const selectionContext = createSelectionContext(
    report.selection,
    bounded(report.documentId, "active-structure"),
    source,
  );
  const results = Array.isArray(report.results)
    ? report.results.slice(0, 8).map((entry) => {
      const result = record(entry) ?? {};
      const error = record(result.error);
      return {
        ok: result.ok === true,
        command: bounded(result.command, "unknown"),
        error: error ? bounded(error.message, "Action failed") : null,
      };
    })
    : [];
  return {
    content: [{
      type: "text" as const,
      text: `Burrete applied ${results.filter((result) => result.ok).length} of ${results.length} requested viewer actions.`,
    }],
    structuredContent: {
      burrete: {
        source: boundedSource(source),
        activeSelection: selectionContext.structuredContent.burrete.activeSelection,
        scene: {
          revision: Math.max(0, Math.trunc(Number(report.revision) || 0)),
          results,
        },
      },
    },
  };
}
