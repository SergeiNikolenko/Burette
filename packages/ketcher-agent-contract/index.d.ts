export type KetcherAgentPhase = "loading" | "ready" | "applying" | "exporting" | "recovering" | "error" | "disposed";
export type KetcherStructureFormat = "ket" | "mol" | "rxn" | "smiles";
export type KetcherOutputFormat = "ket" | "mol" | "rxn" | "sdf" | "smiles" | "reaction_smiles" | "cdxml";
export type KetcherAgentErrorCode =
  | "NOT_READY" | "INVALID_INPUT" | "INVALID_STRUCTURE" | "UNSUPPORTED_FORMAT"
  | "PAYLOAD_TOO_LARGE" | "STALE_TARGET" | "REVISION_CONFLICT" | "INVALID_ATOM_INDEX"
  | "REPLAY_CONFLICT" | "TIMEOUT" | "OUTCOME_UNKNOWN" | "RECOVERY_FAILED"
  | "EXPORT_FAILED" | "PERSIST_CANCELLED" | "TRANSPORT_UNAVAILABLE";

export declare const KETCHER_AGENT_API_VERSION: "burette-ketcher-agent/v1";
export declare const KETCHER_AGENT_LIMITS: {
  readonly inlineBytes: 65536;
  readonly referencedStructureBytes: 1048576;
  readonly smilesChars: 500;
  readonly reactionSmilesChars: 1000;
  readonly atomIndexes: 256;
  readonly textChars: 255;
};
export declare const KETCHER_AGENT_ERROR_CODES: readonly KetcherAgentErrorCode[];

export type KetcherStructureInput = { format: KetcherStructureFormat; content?: string; contentRef?: string };
export type KetcherControlAction = {
  apiVersion?: "burette-ketcher-agent/v1";
  type: "control_ketcher";
  command: "set_structure" | "clear_structure" | "highlight_atoms" | "get_structure" | "request_persist";
  surfaceId: string;
  actionId: string;
  expectedRevision: number;
  format?: string;
  content?: string;
  contentRef?: string;
  indexes?: number[];
  formats?: KetcherOutputFormat[];
  delivery?: "inline" | "artifact" | "download";
  suggestedBasename?: string;
};
export type KetcherRevisionState = {
  surfaceId: string;
  phase: KetcherAgentPhase;
  structureRevision: number;
  interactionRevision: number;
  persistedRevision: number;
  dirty: boolean;
};
export type KetcherSnapshot = KetcherRevisionState & {
  apiVersion: "burette-ketcher-agent/v1";
  structure: {
    kind: "empty" | "molecule" | "reaction";
    atomCount: number;
    bondCount: number;
    componentCount: number;
    smiles: string | null;
    reactionSmiles: string | null;
    smilesOmitted: boolean;
    reactionSmilesOmitted: boolean;
  };
  selectedAtoms: number[];
  selectedAtomCount: number;
  selectionTruncated: boolean;
  highlightedAtoms: number[];
  highlightedAtomCount: number;
  highlightTruncated: boolean;
  lastAction: unknown;
  capabilities: Record<string, boolean>;
};

export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function utf8ByteLength(value: string): number;
export declare function boundedText(value: unknown, max?: number): string;
export declare function normalizeIndexes(value: unknown): number[] | null;
export declare function normalizeStructureInput(input: unknown): { ok: true; value: KetcherStructureInput } | { ok: false; error: { code: KetcherAgentErrorCode; message: string } };
export declare function validateKetcherAction(action: unknown): { ok: true; value: KetcherControlAction & { input?: KetcherStructureInput } } | { ok: false; error: { code: KetcherAgentErrorCode; message: string } };
export declare function createRevisionState(surfaceId: string, phase?: KetcherAgentPhase): KetcherRevisionState;
export declare function applyStructuralRevision(state: KetcherRevisionState): KetcherRevisionState;
export declare function applyInteractionRevision(state: KetcherRevisionState): KetcherRevisionState;
export declare function markPersisted(state: KetcherRevisionState, revision?: number): KetcherRevisionState;
export declare function createKetcherSnapshot(input: {
  state: KetcherRevisionState;
  structure?: Record<string, unknown>;
  selectedAtoms?: number[];
  highlightedAtoms?: number[];
  lastAction?: unknown;
  capabilities?: Record<string, unknown>;
}): KetcherSnapshot;
