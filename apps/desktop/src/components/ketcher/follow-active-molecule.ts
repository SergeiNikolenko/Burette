import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { selectedGroupTab } from "../../lib/group-selection";
import { readStructureText } from "../../lib/structure-text";
import { isKnownViewerMessageSource, isReadOnlyViewerMessageSource, postGridCommand } from "../../lib/viewer-bridge";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";
import type { ViewerDocument } from "../../types";
import type { KetcherLocation } from "../editor-area/page-kinds/ketcher";
import type { KetcherImportRequest, ShellViewState } from "../types";
import { basename } from "../../lib/sidebar-projects";

// A docked Ketcher with no work of its own shows the molecule in the main
// pane: the selected grid row (through the grid's own "Edit in Ketcher", so
// "Save to collection" writes back to that row) or a small structure file.
// A draft is untouched while it is empty or still equals the last import.

type GridSelection = { documentId: string; rowIndex: number };
type KetcherDraft = { ket?: string; molfile?: string };

export type KetcherFollowSource =
  | { kind: "grid-row"; key: string; documentId: string; rowIndex?: number }
  | { kind: "structure"; key: string; documentId: string; path: string; title: string; extension: string };

// The viewer's own Open in Ketcher limits (runtime_viewer.rs ketcher_edit_config).
const STRUCTURE_BYTE_LIMITS: Record<string, number> = { pdb: 512 * 1024, ent: 512 * 1024, mol: 1024 * 1024, sdf: 1024 * 1024, sd: 1024 * 1024 };
const MAX_ATOMS = 300;
// A grid that cannot answer (no selection, read-only) never sends its row.
const GRID_REPLY_WINDOW_MS = 4000;

export function ketcherFollowSource(
  mainTab: MoleculeTab | null | undefined,
  documents: readonly ViewerDocument[],
  gridSelection: GridSelection | null,
): KetcherFollowSource | null {
  const location = mainTab?.location;
  if (location?.kind !== "file") return null;
  const document = documents.find(item => item.id === location.documentId) ?? documents.find(item => item.path === location.path);
  if (!document) return null;
  if (document.renderer === "grid2d") {
    const rowIndex = gridSelection?.documentId === document.id ? gridSelection.rowIndex : undefined;
    return { kind: "grid-row", key: `grid:${document.id}:${rowIndex ?? "selection"}`, documentId: document.id, ...(rowIndex === undefined ? {} : { rowIndex }) };
  }
  const extension = document.extension.toLowerCase();
  const limit = STRUCTURE_BYTE_LIMITS[extension];
  if (!limit || document.byteCount > limit) return null;
  return {
    kind: "structure",
    key: `structure:${document.id}`,
    documentId: document.id,
    path: document.path,
    title: document.title || basename(document.path) || "structure",
    extension,
  };
}

export function ketcherFollowableStructureText(extension: string, text: string) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  if (extension === "pdb" || extension === "ent") {
    if (lines.filter(line => line.startsWith("MODEL ")).length > 1) return false;
    const atoms = lines.filter(line => line.startsWith("ATOM  ") || line.startsWith("HETATM")).length;
    return atoms > 0 && atoms <= MAX_ATOMS;
  }
  if ((extension === "sdf" || extension === "sd") && lines.filter(line => line.startsWith("$$$$")).length > 1) return false;
  const atoms = Number(lines[3]?.slice(0, 3).trim());
  return Number.isSafeInteger(atoms) && atoms > 0 && atoms <= MAX_ATOMS;
}

// Molfile line 2 carries an export timestamp, so it never identifies content.
export function ketcherDraftSignature(draft: KetcherDraft | undefined) {
  const ket = draft?.ket?.trim();
  if (ket) return ket;
  return draft?.molfile?.replace(/\r\n?/gu, "\n").split("\n").slice(2).join("\n").trim() ?? "";
}

export function useKetcherFollowActiveMolecule({
  tabId,
  location,
  state,
  enabled,
  cleanDraftSignature,
  importStructures,
}: {
  tabId: string;
  location: KetcherLocation;
  state: ShellViewState;
  /** The page is shown, its editor is ready and it accepts imports. */
  enabled: boolean;
  /** Signature of the last draft that matched its source (import or applied edit). */
  cleanDraftSignature: RefObject<string>;
  importStructures: (paths: string[], fragments: NonNullable<KetcherImportRequest["fragments"]>) => Promise<unknown>;
}) {
  const mainId = useWorkspacePanesStore(store => store.selectedTabs.main);
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(null);
  const source = ketcherFollowSource(selectedGroupTab(state.tabs, state.activeTabId, { main: mainId }, "main"), state.documents, gridSelection);
  const followedKeyRef = useRef<string | null>(null);
  const seenRequestRef = useRef<number | null | undefined>(undefined);
  const pendingGridRef = useRef<{ at: number; restoreTabId: string | null } | null>(null);
  const draftRef = useRef<KetcherDraft>({});
  draftRef.current = { ket: location.draftKet, molfile: location.draftMolfile };
  const untouched = () => {
    const signature = ketcherDraftSignature(draftRef.current);
    return !signature || signature === cleanDraftSignature.current;
  };

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      const body = data?.source === "burette-grid" ? data.body : null;
      if (body?.type !== "gridMenuStateChanged" || typeof body.documentId !== "string") return;
      const indexes = body.selectedSourceIndexes;
      if (!Array.isArray(indexes) || indexes.length !== 1) return;
      const rowIndex = Number(indexes[0]);
      if (!Number.isSafeInteger(rowIndex) || rowIndex < 0) return;
      if (!isKnownViewerMessageSource(event.source, body.documentId) || isReadOnlyViewerMessageSource(event.source)) return;
      const documentId = body.documentId;
      setGridSelection(current => current?.documentId === documentId && current.rowIndex === rowIndex ? current : { documentId, rowIndex });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  const requestId = location.importRequest?.id ?? location.importRequestId ?? null;
  const sourceKey = source?.key ?? null;
  useLayoutEffect(() => {
    if (requestId !== seenRequestRef.current) {
      const first = seenRequestRef.current === undefined;
      seenRequestRef.current = requestId;
      if (requestId !== null) {
        // An explicit import and a grid's answer to our request both stand for
        // the current molecule; neither is replaced by a follow.
        followedKeyRef.current = sourceKey;
        const pending = pendingGridRef.current;
        pendingGridRef.current = null;
        const store = useMoleculeStore.getState();
        if (!first && pending?.restoreTabId && Date.now() - pending.at < GRID_REPLY_WINDOW_MS
          && store.activeTabId === tabId && store.tabs.some(tab => tab.id === pending.restoreTabId)) {
          // Opening the import focuses Ketcher; a follow keeps the user where they were.
          store.setActiveTab(pending.restoreTabId);
        }
        return;
      }
    }
    if (!enabled || !source || followedKeyRef.current === source.key) return;
    // Judge the draft when the molecule changes: clearing the canvas later is
    // not a request to load whatever is in front.
    followedKeyRef.current = source.key;
    if (!untouched()) return;
    if (source.kind === "grid-row") {
      const activeTabId = useMoleculeStore.getState().activeTabId;
      pendingGridRef.current = { at: Date.now(), restoreTabId: activeTabId !== tabId ? activeTabId : null };
      postGridCommand(source.documentId, "structure.edit-in-ketcher", source.rowIndex);
      return;
    }
    const key = source.key;
    void readStructureText(source.path).then(text => {
      if (followedKeyRef.current !== key || !untouched() || !ketcherFollowableStructureText(source.extension, text)) return;
      return importStructures([], [{ title: source.title, text }]);
    }).catch(() => {});
  });
}
