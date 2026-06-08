import { resolveDropActionChoices, type DropActionChoice, type DropSourceContext, type DropTargetContext } from "../lib/drop-actions";
import { structureDragRecordsToFragments, type StructureDragPayload } from "../lib/structure-drag";
import type { ShellActions } from "./types";
import { showNativeContextMenu } from "./native-context-menu";

type DropPoint = { x: number; y: number };

type ShellDropActionHandlers = {
  addXyzrenderSheetItems?: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  importKetcherStructures?: (payload: StructureDragPayload) => boolean;
};

export function shellDropActionChoices(
  payload: StructureDragPayload,
  target: DropTargetContext,
  source: DropSourceContext = { kind: "unknown" },
) {
  return resolveDropActionChoices(payload, target, source).filter((choice) => canRunShellDropAction(choice));
}

export function runShellDropActionChoices(
  actions: ShellActions,
  payload: StructureDragPayload,
  choices: DropActionChoice[],
  point?: DropPoint | null,
  handlers: ShellDropActionHandlers = {},
) {
  if (choices.length === 0) return false;
  const runChoice = (choice: DropActionChoice) => runShellDropAction(actions, payload, choice, handlers);
  if (choices.length === 1) {
    runChoice(choices[0]);
    return true;
  }
  void showNativeContextMenu(
    choices.map((choice, index) => ({
      kind: "item" as const,
      id: `drop-action-${index}-${choice.id}`,
      text: choice.confidence === "default" ? `${choice.label} (default)` : choice.label,
      action: () => runChoice(choice),
    })),
    point ?? undefined,
  ).catch(() => runChoice(choices[0]));
  return true;
}

function canRunShellDropAction(choice: DropActionChoice) {
  const action = choice.action;
  return action.kind !== "show-inline-record-target-hint";
}

function runShellDropAction(
  actions: ShellActions,
  payload: StructureDragPayload,
  choice: DropActionChoice,
  handlers: ShellDropActionHandlers,
) {
  const action = choice.action;
  if (action.kind === "merge-collection") {
    void actions.mergeMoleculeCollections(action.targetPath, action.paths);
    return;
  }
  if (action.kind === "append-grid-records") {
    actions.appendGridRecords(action.targetDocumentId, action.payload);
    return;
  }
  if (action.kind === "add-xyzrender-sheet-items") {
    if (action.targetDocumentId && handlers.addXyzrenderSheetItems?.(action.targetDocumentId, action.payload)) return;
    if (action.targetDocumentId) actions.addXyzrenderSheetItems(action.targetDocumentId, action.payload);
    return;
  }
  if (action.kind === "open-docking") {
    void actions.openDockingDocument(action.request.receptorPath, action.request.ligandPaths);
    return;
  }
  if (action.kind === "open-docking-with-records") {
    void actions.openDockingStructureRecords(action.receptorPath, action.ligandPaths, action.records);
    return;
  }
  if (action.kind === "import-ketcher-structures") {
    if (handlers.importKetcherStructures?.(action.payload)) return;
    actions.openKetcherWithStructures(action.payload.paths, structureDragRecordsToFragments(action.payload.records));
    return;
  }
  if (action.kind === "prepare-fep-setup") {
    actions.openFepSetupWorkspace(action.request);
    return;
  }
  if (action.kind === "open-documents") {
    void actions.openStructurePaths(action.paths);
    return;
  }
  if (action.kind === "open-text-files") {
    void actions.openTextPaths(action.paths);
    return;
  }
  if (action.kind === "open-structure-records") {
    if (action.paths.length > 0) void actions.openStructurePaths(action.paths);
    if (action.records.length > 0) void actions.openStructureRecords(action.records);
    return;
  }
  void actions.openStructurePaths(payload.paths);
}
