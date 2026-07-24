import {
  KETCHER_AGENT_ERROR_CODES,
  KETCHER_AGENT_LIMITS,
  applyInteractionRevision,
  applyStructuralRevision,
  createKetcherSnapshot,
  createRevisionState,
  validateKetcherAction,
  type KetcherAgentErrorCode,
  type KetcherControlAction,
  type KetcherSnapshot,
} from "@burette/ketcher-agent-contract";
import type { KetcherEditorApi } from "../components/ketcher-editor";

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

type StructureSummary = {
  kind: "empty" | "molecule" | "reaction";
  atomCount: number;
  bondCount: number;
  componentCount: number;
  smiles?: string;
  reactionSmiles?: string;
};

const controllers = new Map<string, KetcherAgentController>();

export const KETCHER_AGENT_SURFACE_PREFIX = "desktop-ketcher:";

export function ketcherSurfaceId(tabId: string) {
  return `${KETCHER_AGENT_SURFACE_PREFIX}${tabId}`;
}

export function registerKetcherAgentController(tabId: string, editor: KetcherAgentEditor) {
  const existing = controllers.get(tabId);
  existing?.dispose();
  const controller = new KetcherAgentController(tabId, editor);
  controllers.set(tabId, controller);
  return controller;
}

export function unregisterKetcherAgentController(tabId: string, controller?: KetcherAgentController) {
  const current = controllers.get(tabId);
  if (!current || (controller && current !== controller)) return;
  current.dispose();
  controllers.delete(tabId);
}

export function getKetcherAgentController(tabId: string | null | undefined) {
  return tabId ? controllers.get(tabId) ?? null : null;
}

export function getKetcherAgentSnapshots() {
  return Array.from(controllers.values()).map((controller) => controller.snapshot());
}

export class KetcherAgentController {
  readonly tabId: string;
  readonly surfaceId: string;
  private readonly editor: KetcherAgentEditor;
  private state = createRevisionState("");
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

  constructor(tabId: string, editor: KetcherAgentEditor) {
    this.tabId = tabId;
    this.surfaceId = ketcherSurfaceId(tabId);
    this.editor = editor;
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
    });
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
      return this.failure(action.command, "REVISION_CONFLICT", "The Ketcher structure revision is stale.", action.actionId);
    }
    if (action.command === "highlight_atoms") return this.applyHighlights(action);
    if (action.command === "get_structure") return this.exportStructure(action);
    if (action.command === "request_persist") return this.requestPersist(action);
    return this.applyStructure(action);
  }

  private async applyStructure(action: KetcherControlAction & { input?: { format: string; content?: string; contentRef?: string } }) {
    const previousKet = this.lastKet;
    const previousSummary = this.summary;
    const previousState = this.state;
    this.state = { ...this.state, phase: "applying" };
    this.emit();
    try {
      const input = action.command === "clear_structure" ? null : action.input;
      if (input?.contentRef) {
        this.state = { ...this.state, phase: "ready" };
        this.emit();
        return this.failure(action.command, "TRANSPORT_UNAVAILABLE", "Local contentRef resolution is not available yet.", action.actionId);
      }
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
      return { ok: true, command: action.command, actionId: action.actionId, result: { delivery: action.delivery, formats: result }, snapshot: this.snapshot() };
    } catch (error) {
      this.state = { ...this.state, phase: "ready" };
      this.emit();
      return this.failure(action.command, "EXPORT_FAILED", boundedError(error), action.actionId);
    }
  }

  private async requestPersist(action: KetcherControlAction & { format?: string; suggestedBasename?: string }) {
    this.lastAction = { ok: true, command: action.command, actionId: action.actionId, status: "awaiting_user" };
    this.emit();
    return {
      ok: true,
      command: action.command,
      actionId: action.actionId,
      result: { status: "awaiting_user", format: action.format, suggestedBasename: action.suggestedBasename },
      snapshot: this.snapshot(),
    };
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
