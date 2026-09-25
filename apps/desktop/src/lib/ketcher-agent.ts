import {
  KETCHER_AGENT_ERROR_CODES,
  KETCHER_AGENT_LIMITS,
  applyInteractionRevision,
  applyStructuralRevision,
  boundedText,
  createKetcherSnapshot,
  createRevisionState,
  markPersisted,
  validateKetcherAction,
  type KetcherAgentErrorCode,
  type KetcherControlAction,
  type KetcherOutputFormat,
  type KetcherPersistRequest,
  type KetcherSnapshot,
} from "@burette/ketcher-agent-contract";
import type { KetcherEditorApi } from "../components/ketcher-editor";
import type { TextFileSaveOutcome } from "./file-export";

export type KetcherAgentEditor = {
  containsReaction?: () => boolean;
  getKet: () => Promise<string>;
  getMolfile: KetcherEditorApi["getMolfile"];
  getRxn?: KetcherEditorApi["getRxn"];
  getSdf?: KetcherEditorApi["getSdf"];
  getCDXml?: KetcherEditorApi["getCDXml"];
  getSmiles?: KetcherEditorApi["getSmiles"];
  setMolecule: (value: string, options?: { needZoom?: boolean }) => Promise<void>;
  setMolfile: (value: string) => Promise<void>;
  subscribeChange: (handler: () => void) => () => void;
  subscribeSelection?: (handler: () => void) => () => void;
  getSelectedAtomIndexes?: () => number[];
  setAgentHighlightedAtomIndexes?: (indexes: number[]) => void;
};

export type KetcherAgentResult = {
  ok: boolean;
  command: string;
  actionId?: string;
  snapshot?: KetcherSnapshot;
  result?: Record<string, unknown>;
  error?: { code: KetcherAgentErrorCode; message: string };
};

/** Host services the controller needs beyond the Ketcher editor itself. */
export type KetcherAgentHost = {
  /** Reads a local structure file through the workspace's authorized file reader, capped at `maxBytes`. */
  readContentRef?: (path: string, maxBytes: number) => Promise<{ content: string; byteCount: number; truncated: boolean }>;
};

/** Writes a user-confirmed export; only UI code that owns a save dialog may provide it. */
export type KetcherPersistWriter = (file: { fileName: string; extension: string; text: string }) => Promise<TextFileSaveOutcome>;

type StructureSummary = {
  kind: "empty" | "molecule" | "reaction";
  atomCount: number;
  bondCount: number;
  componentCount: number;
  smiles?: string;
  reactionSmiles?: string;
};

type StructureInput = { format: string; content?: string; contentRef?: string };
type ContentRefResult = { ok: true; content: string } | { ok: false; code: KetcherAgentErrorCode; message: string };

const CONTENT_REF_EXTENSIONS: Record<string, readonly string[]> = {
  mol: ["mol", "sdf", "sd", "mdl"],
  rxn: ["rxn"],
  ket: ["ket"],
};
const PERSIST_EXTENSIONS: Record<KetcherOutputFormat, string> = {
  ket: "ket",
  mol: "mol",
  rxn: "rxn",
  sdf: "sdf",
  smiles: "smi",
  reaction_smiles: "smi",
  cdxml: "cdxml",
};

const desktopKetcherAgentHost: KetcherAgentHost = {
  readContentRef: async (path, maxBytes) => {
    const { readStructureTextDocument } = await import("./structure-text");
    const document = await readStructureTextDocument(path, undefined, { maxBytes });
    return { content: document.content, byteCount: document.byteCount, truncated: document.truncated };
  },
};

const controllers = new Map<string, KetcherAgentController>();
const controllerSubscriptions = new Map<string, () => void>();
const registryListeners = new Set<() => void>();

export const KETCHER_AGENT_SURFACE_PREFIX = "desktop-ketcher:";

export function ketcherSurfaceId(tabId: string) {
  return `${KETCHER_AGENT_SURFACE_PREFIX}${tabId}`;
}

export function registerKetcherAgentController(tabId: string, editor: KetcherAgentEditor, host: KetcherAgentHost = desktopKetcherAgentHost) {
  const existing = controllers.get(tabId);
  controllerSubscriptions.get(tabId)?.();
  existing?.dispose();
  const controller = new KetcherAgentController(tabId, editor, host);
  controllers.set(tabId, controller);
  controllerSubscriptions.set(tabId, controller.subscribe(emitRegistryChange));
  emitRegistryChange();
  return controller;
}

export function unregisterKetcherAgentController(tabId: string, controller?: KetcherAgentController) {
  const current = controllers.get(tabId);
  if (!current || (controller && current !== controller)) return;
  controllerSubscriptions.get(tabId)?.();
  controllerSubscriptions.delete(tabId);
  current.dispose();
  controllers.delete(tabId);
  emitRegistryChange();
}

export function getKetcherAgentController(tabId: string | null | undefined) {
  return tabId ? controllers.get(tabId) ?? null : null;
}

export function getKetcherAgentSnapshots() {
  return Array.from(controllers.values()).map((controller) => controller.snapshot());
}

export function subscribeKetcherAgentRegistry(listener: () => void) {
  registryListeners.add(listener);
  return () => { registryListeners.delete(listener); };
}

function emitRegistryChange() {
  for (const listener of registryListeners) listener();
}

export class KetcherAgentController {
  readonly tabId: string;
  readonly surfaceId: string;
  private readonly editor: KetcherAgentEditor;
  private readonly host: KetcherAgentHost;
  private state = createRevisionState("");
  private persistRequest: KetcherPersistRequest | null = null;
  private summary: StructureSummary = emptySummary();
  private selectedAtoms: number[] = [];
  private highlightedAtoms: number[] = [];
  private lastKet = "";
  private lastAction: unknown = null;
  private disposed = false;
  private agentMutationDepth = 0;
  private operation: Promise<unknown> = Promise.resolve();
  private readonly actionResults = new Map<string, { hash: string; result: KetcherAgentResult }>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeChange: () => void;
  private readonly unsubscribeSelection: () => void;

  constructor(tabId: string, editor: KetcherAgentEditor, host: KetcherAgentHost = {}) {
    this.tabId = tabId;
    this.surfaceId = ketcherSurfaceId(tabId);
    this.editor = editor;
    this.host = host;
    this.state = createRevisionState(this.surfaceId, "loading");
    this.unsubscribeChange = editor.subscribeChange(() => {
      void this.handleEditorChange();
    });
    this.unsubscribeSelection = editor.subscribeSelection?.(() => {
      const next = this.readSelectedAtoms();
      if (sameNumbers(this.selectedAtoms, next)) return;
      this.selectedAtoms = next;
      this.state = applyInteractionRevision(this.state);
      this.emit();
    }) ?? (() => undefined);
    void this.initialize();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): KetcherSnapshot {
    return createKetcherSnapshot({
      state: this.state,
      structure: this.summary,
      selectedAtoms: this.selectedAtoms,
      highlightedAtoms: this.highlightedAtoms,
      lastAction: this.lastAction,
      capabilities: {
        setStructure: !this.disposed,
        highlightAtoms: !this.disposed,
        getStructure: !this.disposed,
        persist: !this.disposed,
      },
      persistRequest: this.persistRequest,
    });
  }

  /** The pending or last agent save request; the UI uses it to render the confirmation. */
  getPersistRequest() {
    return this.persistRequest;
  }

  /**
   * Completes an agent `request_persist` after the user confirmed it in the UI.
   * This is deliberately not reachable through `execute`: agents can only ask.
   */
  async confirmPersist(write: KetcherPersistWriter) {
    const request = this.persistRequest;
    if (this.disposed || !request || request.status !== "awaiting_user") return;
    this.setPersistRequest({ ...request, status: "saving" });
    let outcome: TextFileSaveOutcome;
    let revision = this.state.structureRevision;
    try {
      const text = await this.enqueue(async () => {
        revision = this.state.structureRevision;
        return this.exportFormat(request.format);
      });
      outcome = await write({ fileName: request.fileName, extension: PERSIST_EXTENSIONS[request.format], text });
    } catch (error) {
      outcome = { status: "failed", message: boundedError(error) };
    }
    if (this.disposed) return;
    if (outcome.status === "saved") {
      this.state = revision === this.state.structureRevision
        ? markPersisted(this.state, revision)
        : { ...this.state, persistedRevision: revision, dirty: true };
      this.lastAction = { ok: true, command: "request_persist", actionId: request.actionId, status: "saved" };
      this.setPersistRequest({
        ...request,
        status: "saved",
        persistedRevision: revision,
        savedPath: outcome.path ? outcome.path.slice(0, 4096) : null,
      });
    } else if (outcome.status === "cancelled") {
      this.finishPersistWithoutSave(request, "cancelled", "PERSIST_CANCELLED", "The user cancelled the save.");
    } else {
      this.finishPersistWithoutSave(request, "failed", "EXPORT_FAILED", boundedText(outcome.message) || "The file could not be saved.");
    }
  }

  /** Declines a pending agent save request from the UI. */
  cancelPersist() {
    const request = this.persistRequest;
    if (this.disposed || !request || request.status !== "awaiting_user") return;
    this.finishPersistWithoutSave(request, "cancelled", "PERSIST_CANCELLED", "The user declined the save.");
  }

  async execute(rawAction: unknown): Promise<KetcherAgentResult> {
    const validated = validateKetcherAction(rawAction);
    if (!validated.ok) return this.failure("control_ketcher", validated.error.code, validated.error.message);
    const action = validated.value as KetcherControlAction & { input?: { format: string; content?: string; contentRef?: string } };
    const actionHash = stableActionHash(action);
    const previous = this.actionResults.get(action.actionId);
    if (previous) {
      if (previous.hash !== actionHash) return this.failure(action.command, "REPLAY_CONFLICT", "actionId was already used for another payload.", action.actionId);
      return previous.result;
    }
    const result = await this.enqueue(() => this.executeValidated(action));
    this.actionResults.set(action.actionId, { hash: actionHash, result });
    while (this.actionResults.size > 256) {
      const oldest = this.actionResults.keys().next().value;
      if (!oldest) break;
      this.actionResults.delete(oldest);
    }
    return result;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeChange();
    this.unsubscribeSelection();
    this.state = { ...this.state, phase: "disposed" };
    this.emit();
    this.listeners.clear();
  }

  private async initialize() {
    try {
      await this.refreshStructure();
      this.state = { ...this.state, phase: "ready" };
      this.emit();
    } catch (error) {
      this.state = { ...this.state, phase: "error" };
      this.lastAction = { ok: false, error: boundedError(error) };
      this.emit();
    }
  }

  private async handleEditorChange() {
    if (this.disposed || this.agentMutationDepth > 0 || this.state.phase === "recovering") return;
    try {
      const nextKet = await this.editor.getKet();
      if (nextKet === this.lastKet) return;
      this.lastKet = nextKet;
      this.summary = await this.readSummary();
      this.selectedAtoms = this.readSelectedAtoms();
      this.state = applyStructuralRevision(this.state);
      this.emit();
    } catch {
      // The editor may emit before its structure service has finished applying.
    }
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async executeValidated(action: KetcherControlAction & { input?: { format: string; content?: string; contentRef?: string } }): Promise<KetcherAgentResult> {
    if (this.disposed || this.state.phase === "disposed") return this.failure(action.command, "STALE_TARGET", "The Ketcher editor has been disposed.", action.actionId);
    if (action.surfaceId !== this.surfaceId) return this.failure(action.command, "STALE_TARGET", "The requested Ketcher surface is not registered.", action.actionId);
    if (this.state.phase !== "ready") return this.failure(action.command, "NOT_READY", "The Ketcher editor is not ready.", action.actionId);
    if (action.expectedRevision !== this.state.structureRevision) {
      return this.failure(action.command, "REVISION_CONFLICT", revisionConflictMessage(action.expectedRevision, this.state.structureRevision), action.actionId);
    }
    if (action.command === "highlight_atoms") return this.applyHighlights(action);
    if (action.command === "get_structure") return this.exportStructure(action);
    if (action.command === "request_persist") return this.requestPersist(action);
    return this.applyStructure(action);
  }

  private async applyStructure(action: KetcherControlAction & { input?: StructureInput }) {
    let input = action.command === "clear_structure" ? null : action.input ?? null;
    if (input?.contentRef) {
      const resolved = await this.readContentRef(input.format, input.contentRef);
      if (!resolved.ok) return this.failure(action.command, resolved.code, resolved.message, action.actionId);
      input = { format: input.format, content: resolved.content };
    }
    const previousKet = this.lastKet;
    const previousSummary = this.summary;
    const previousState = this.state;
    this.state = { ...this.state, phase: "applying" };
    this.emit();
    try {
      this.agentMutationDepth += 1;
      if (!input) await this.editor.setMolecule("");
      else if (input.format === "mol") await this.editor.setMolfile(input.content ?? "");
      else await this.editor.setMolecule(input.content ?? "", { needZoom: true });
      await waitForEditorPaint();
      const nextKet = await this.editor.getKet();
      if (action.command === "set_structure" && !nextKet.trim()) throw new Error("Ketcher returned an empty structure after set_structure.");
      this.lastKet = nextKet;
      this.summary = await this.readSummary();
      this.selectedAtoms = [];
      this.highlightedAtoms = [];
      this.editor.setAgentHighlightedAtomIndexes?.([]);
      this.state = applyStructuralRevision({ ...this.state, phase: "ready" });
      this.lastAction = { ok: true, command: action.command, actionId: action.actionId };
      this.emit();
      return { ok: true, command: action.command, actionId: action.actionId, snapshot: this.snapshot() };
    } catch (error) {
      const recovered = await this.restore(previousKet);
      if (!recovered) {
        this.state = { ...this.state, phase: "error" };
        this.summary = previousSummary;
        this.lastKet = previousKet;
        this.lastAction = { ok: false, command: action.command, actionId: action.actionId, error: { code: "RECOVERY_FAILED" } };
        this.emit();
        return this.failure(action.command, "RECOVERY_FAILED", "Ketcher could not restore the previous structure.", action.actionId);
      }
      this.state = { ...previousState, phase: "ready" };
      this.summary = previousSummary;
      this.lastKet = previousKet;
      this.lastAction = { ok: false, command: action.command, actionId: action.actionId, error: boundedError(error) };
      this.emit();
      return this.failure(action.command, "INVALID_STRUCTURE", boundedError(error), action.actionId);
    } finally {
      this.agentMutationDepth = Math.max(0, this.agentMutationDepth - 1);
    }
  }

  private async applyHighlights(action: KetcherControlAction & { indexes?: number[] }) {
    const indexes = action.indexes ?? [];
    const atomCount = this.summary.atomCount;
    if (indexes.some((index) => index >= atomCount)) {
      return this.failure(action.command, "INVALID_ATOM_INDEX", "An atom index is outside the current structure.", action.actionId);
    }
    if (!sameNumbers(this.highlightedAtoms, indexes)) {
      this.highlightedAtoms = [...indexes];
      this.editor.setAgentHighlightedAtomIndexes?.(this.highlightedAtoms);
      this.state = applyInteractionRevision(this.state);
      this.emit();
    }
    this.lastAction = { ok: true, command: action.command, actionId: action.actionId };
    return { ok: true, command: action.command, actionId: action.actionId, snapshot: this.snapshot() };
  }

  private async exportStructure(action: KetcherControlAction & { formats?: string[]; delivery?: string }) {
    const delivery = action.delivery ?? "inline";
    if (delivery !== "inline") {
      // The desktop file session has no artifact channel; never relabel inline data.
      return this.failure(
        action.command,
        "TRANSPORT_UNAVAILABLE",
        `delivery "${delivery}" is not available on the desktop Ketcher surface; use delivery "inline" (up to 64 KiB) or request_persist to save a file.`,
        action.actionId,
      );
    }
    const result: Record<string, unknown> = {};
    this.state = { ...this.state, phase: "exporting" };
    this.emit();
    try {
      for (const format of action.formats ?? []) {
        const value = await this.exportFormat(format);
        if (new TextEncoder().encode(value).byteLength > KETCHER_AGENT_LIMITS.inlineBytes) {
          this.state = { ...this.state, phase: "ready" };
          this.emit();
          return this.failure(action.command, "PAYLOAD_TOO_LARGE", "Inline export exceeds 64 KiB.", action.actionId);
        }
        result[format] = value;
      }
      this.state = { ...this.state, phase: "ready" };
      this.lastAction = { ok: true, command: action.command, actionId: action.actionId };
      this.emit();
      return { ok: true, command: action.command, actionId: action.actionId, result: { delivery, formats: result }, snapshot: this.snapshot() };
    } catch (error) {
      this.state = { ...this.state, phase: "ready" };
      this.emit();
      return this.failure(action.command, "EXPORT_FAILED", boundedError(error), action.actionId);
    }
  }

  private async requestPersist(action: KetcherControlAction & { format?: string; suggestedBasename?: string }) {
    if (this.persistRequest?.status === "saving") {
      return this.failure(action.command, "NOT_READY", "A confirmed save is still being written; retry after it finishes.", action.actionId);
    }
    const format = action.format as KetcherOutputFormat;
    const suggestedBasename = action.suggestedBasename ?? "ketcher-structure";
    const extension = PERSIST_EXTENSIONS[format];
    const fileName = suggestedBasename.toLowerCase().endsWith(`.${extension}`) ? suggestedBasename : `${suggestedBasename}.${extension}`;
    // A newer request replaces an unanswered one; the user only ever confirms the latest.
    this.persistRequest = {
      actionId: action.actionId,
      status: "awaiting_user",
      format,
      suggestedBasename,
      fileName,
      requestedRevision: this.state.structureRevision,
      persistedRevision: null,
      savedPath: null,
      error: null,
    };
    this.lastAction = { ok: true, command: action.command, actionId: action.actionId, status: "awaiting_user" };
    this.emit();
    return {
      ok: true,
      command: action.command,
      actionId: action.actionId,
      result: { status: "awaiting_user", format, suggestedBasename, fileName, requestedRevision: this.state.structureRevision },
      snapshot: this.snapshot(),
    };
  }

  private finishPersistWithoutSave(request: KetcherPersistRequest, status: "cancelled" | "failed", code: KetcherAgentErrorCode, message: string) {
    this.lastAction = { ok: false, command: "request_persist", actionId: request.actionId, error: { code, message } };
    this.setPersistRequest({ ...request, status, error: status === "failed" ? message : null });
  }

  private setPersistRequest(request: KetcherPersistRequest) {
    this.persistRequest = request;
    this.emit();
  }

  private async readContentRef(format: string, contentRef: string): Promise<ContentRefResult> {
    const read = this.host.readContentRef;
    if (!read) return { ok: false, code: "TRANSPORT_UNAVAILABLE", message: "This Ketcher surface cannot resolve contentRef; send inline content instead." };
    const path = localContentRefPath(contentRef);
    if (!path) return { ok: false, code: "INVALID_INPUT", message: "contentRef must be an absolute local file path or a file:// URL." };
    const allowed = CONTENT_REF_EXTENSIONS[format] ?? [];
    if (!allowed.includes(pathExtension(path))) {
      return { ok: false, code: "UNSUPPORTED_FORMAT", message: `contentRef for format ${format} must point to a ${allowed.map((extension) => `.${extension}`).join(", ")} file.` };
    }
    const limit = KETCHER_AGENT_LIMITS.referencedStructureBytes;
    let file: Awaited<ReturnType<NonNullable<KetcherAgentHost["readContentRef"]>>>;
    try {
      file = await read(path, limit);
    } catch (error) {
      const reason = boundedError(error);
      if (/forbidden|not available to browser dev|\b403\b/iu.test(reason)) {
        return { ok: false, code: "INVALID_INPUT", message: "contentRef is outside the files this workspace is authorized to read." };
      }
      return { ok: false, code: "INVALID_INPUT", message: boundedText(`contentRef could not be read: ${reason}`) };
    }
    if (file.truncated || file.byteCount > limit) {
      return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "contentRef exceeds the 1 MiB referenced structure limit." };
    }
    return { ok: true, content: file.content };
  }

  private async exportFormat(format: string) {
    if (format === "ket") return this.editor.getKet();
    if (format === "mol") return this.editor.getMolfile("v2000");
    if (format === "rxn") return this.editor.getRxn?.("v2000") ?? "";
    if (format === "smiles") return this.editor.getSmiles?.() ?? "";
    if (format === "reaction_smiles") return this.editor.getSmiles?.() ?? "";
    if (format === "sdf") return this.editor.getSdf?.("v2000") ?? this.editor.getMolfile("v2000");
    if (format === "cdxml") {
      const value = await this.editor.getCDXml?.();
      if (value === undefined) throw new Error("The Ketcher runtime does not expose CDXML export.");
      return value;
    }
    throw new Error(`Unsupported export format: ${format}`);
  }

  private async refreshStructure() {
    this.lastKet = await this.editor.getKet();
    this.summary = await this.readSummary();
    this.selectedAtoms = this.readSelectedAtoms();
  }

  private async readSummary(): Promise<StructureSummary> {
    const molfile = await this.editor.getMolfile("v2000");
    const counts = molfileCounts(molfile);
    const smiles = await safeEditorExport(() => this.editor.getSmiles?.());
    const reactionSmiles = await safeEditorExport(() => this.editor.getRxn?.("v2000"));
    const kind = this.editor.containsReaction?.() || Boolean(reactionSmiles?.trim()) ? "reaction" : counts.atomCount > 0 ? "molecule" : "empty";
    return {
      kind,
      atomCount: counts.atomCount,
      bondCount: counts.bondCount,
      componentCount: smiles?.trim() ? smiles.split(".").length : counts.atomCount > 0 ? 1 : 0,
      ...(smiles?.trim() ? { smiles: smiles.trim() } : {}),
      ...(reactionSmiles?.trim() ? { reactionSmiles: reactionSmiles.trim() } : {}),
    };
  }

  private readSelectedAtoms() {
    const selected = this.editor.getSelectedAtomIndexes?.() ?? [];
    return Array.from(new Set(selected.filter((index) => Number.isSafeInteger(index) && index >= 0))).sort((left, right) => left - right);
  }

  private async restore(ket: string) {
    try {
      this.agentMutationDepth += 1;
      await this.editor.setMolecule(ket, { needZoom: true });
      await waitForEditorPaint();
      return (await this.editor.getKet()) === ket;
    } catch {
      return false;
    } finally {
      this.agentMutationDepth = Math.max(0, this.agentMutationDepth - 1);
    }
  }

  private failure(command: string, code: KetcherAgentErrorCode, message: string, actionId?: string): KetcherAgentResult {
    if (!KETCHER_AGENT_ERROR_CODES.includes(code)) code = "INVALID_INPUT";
    this.lastAction = { ok: false, command, ...(actionId ? { actionId } : {}), error: { code, message } };
    const result = { ok: false, command, ...(actionId ? { actionId } : {}), error: { code, message }, snapshot: this.snapshot() };
    this.emit();
    return result;
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

function revisionConflictMessage(expected: number, current: number) {
  return expected > current
    ? `expectedRevision ${expected} is ahead of the current structure revision ${current}; observe the surface and retry with the current revision.`
    : `expectedRevision ${expected} is stale; the current structure revision is ${current}.`;
}

function localContentRefPath(contentRef: string) {
  let path = contentRef.trim();
  if (/^file:/iu.test(path)) {
    try {
      const url = new URL(path);
      if (url.host && url.host !== "localhost") return null;
      path = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  if (!path.startsWith("/") || path.split("/").includes("..")) return null;
  return path;
}

function pathExtension(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function emptySummary(): StructureSummary {
  return { kind: "empty", atomCount: 0, bondCount: 0, componentCount: 0 };
}

function molfileCounts(molfile: string) {
  const v3000 = /M\s+V30\s+COUNTS\s+(\d+)\s+(\d+)/u.exec(molfile);
  if (v3000) return { atomCount: Number(v3000[1]), bondCount: Number(v3000[2]) };
  const counts = molfile.split(/\r?\n/u).find((line) => /^\s*\d+\s+\d+(?:\s+\d+){4,}\s+V2000\s*$/u.test(line));
  if (!counts) return { atomCount: 0, bondCount: 0 };
  const fields = counts.trim().split(/\s+/u);
  return { atomCount: Number(fields[0]) || 0, bondCount: Number(fields[1]) || 0 };
}

function sameNumbers(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function safeEditorExport(operation: (() => Promise<string | undefined> | undefined) | undefined) {
  if (!operation) return undefined;
  try {
    return await operation();
  } catch {
    return undefined;
  }
}

function stableActionHash(action: KetcherControlAction) {
  const { actionId: _actionId, ...payload } = action;
  return JSON.stringify(payload);
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, KETCHER_AGENT_LIMITS.textChars);
}

function waitForEditorPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}
