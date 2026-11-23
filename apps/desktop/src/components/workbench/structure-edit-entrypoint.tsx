import { useEffect, useRef, useState } from "react";
import type { ViewerDocument } from "../../types";
import type { ShellActions, ShellViewState, StructureViewerAction } from "../types";
import { useLogicalSource } from "../../lib/science-session/state";
import { useTrajectoryFrame } from "../../lib/workbench/source";
import { edit3dMode, openEdit3d, type Edit3dLigandScope } from "../../lib/workbench/edit-3d";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

type SelectedStructureEntity = {
  group: string;
  row: { label: string };
  action: StructureViewerAction;
};

function resolveLigandScope(
  document: ViewerDocument,
  viewerLigandSelection: ShellViewState["viewerLigandSelection"],
  selectedEntity?: SelectedStructureEntity | null,
): Edit3dLigandScope | null {
  if (viewerLigandSelection?.documentId === document.id) {
    return {
      label: viewerLigandSelection.label,
      selector: viewerLigandSelection.selector,
      atoms: viewerLigandSelection.atoms,
    };
  }
  if (selectedEntity?.group === "Ligand" && selectedEntity.action.type === "focus_ligand") {
    return {
      label: selectedEntity.row.label,
      selector: selectedEntity.action.selector,
    };
  }
  return null;
}

function detailText(mode: ReturnType<typeof edit3dMode>, ligand: Edit3dLigandScope | null, multiFrame: boolean) {
  if (mode === "in-place-graph") return "Atoms, bonds & coordinates";
  if (mode === "in-place-geometry") return multiFrame ? "Active frame · editable 3D copy" : "Bond lengths, angles & Z-matrix";
  if (ligand) return `${ligand.label} · opens 3D copy`;
  return "Opens editable 3D copy";
}

/** Info panel entry point for 3D structure editing across all supported 3D formats. */
export function StructureEditToolRow({
  document,
  viewerLigandSelection,
  selectedEntity,
  actions,
}: {
  document: ViewerDocument;
  viewerLigandSelection: ShellViewState["viewerLigandSelection"];
  selectedEntity?: SelectedStructureEntity | null;
  actions: ShellActions;
}) {
  useLogicalSource(document.id);
  const frame = useTrajectoryFrame(document.id);
  const mode = edit3dMode(document);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setError(null);
  }, [document.id]);

  useEffect(() => () => {
    controllerRef.current?.abort();
  }, []);

  if (!mode) return null;
  const ligand = resolveLigandScope(document, viewerLigandSelection, selectedEntity);
  const multiFrame = Boolean(frame && frame.frameCount > 1);
  const detail = detailText(mode, ligand, multiFrame);

  const run = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      await openEdit3d(document, actions, {
        ligand,
        frameIndex: frame?.frameIndex,
        signal: controller.signal,
      });
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-1" role="listitem">
      <div className="flex min-w-0 items-center gap-2 py-1">
        <div className="min-w-0 flex-1 px-2">
          <div className="truncate text-sm">Edit in 3D</div>
          <div className="truncate text-xs text-muted-foreground">{detail}</div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={busy}
          aria-label="Edit in 3D"
          onClick={() => void run()}
        >
          {busy ? <Spinner aria-label="Preparing 3D editor" className="size-3" /> : "Edit"}
        </Button>
      </div>
      {error ? <p role="alert" className="px-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
