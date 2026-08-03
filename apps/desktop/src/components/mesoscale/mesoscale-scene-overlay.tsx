import { useEffect } from "react";
import type { MouseEvent } from "react";
import { Contrast, Layers3, MoreHorizontal, Redo2, Undo2, X } from "lucide-react";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { MesoscaleScenePanel } from "./mesoscale-scene-panel";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";
import { showNativeContextMenu } from "../native-context-menu";

export function MesoscaleSceneOverlay({ document, onClose }: { document: ViewerDocument; onClose: () => void }) {
  const summary = useMesoscaleStore((state) => state.sessions[document.id]?.summary);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (window.document.querySelector('[data-slot="context-menu-content"], [data-slot="dropdown-menu-content"]')) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(document.id, action).catch(() => undefined);
  const hoverDimming = summary?.hoverDimming ?? true;
  const openSceneMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const snapshots = summary?.snapshots ?? [];
    const current = snapshots.find((snapshot) => snapshot.current);
    void showNativeContextMenu([
      { kind: "label", id: "mesoscale-scene-session", text: "Scene" },
      { kind: "item", id: "mesoscale-create-snapshot", text: "Create snapshot", action: () => run({ type: "createSnapshot", name: `Snapshot ${snapshots.length + 1}` }) },
      { kind: "select", id: "mesoscale-apply-snapshot", label: "Snapshot", value: current?.id ?? "", options: snapshots.map((snapshot) => snapshot.id), optionLabels: Object.fromEntries(snapshots.map((snapshot) => [snapshot.id, snapshot.name])), disabled: snapshots.length === 0, action: (id) => run({ type: "applySnapshot", id }) },
      { kind: "item", id: "mesoscale-delete-snapshot", text: "Delete current snapshot", disabled: !current, action: current ? () => run({ type: "deleteSnapshot", id: current.id }) : undefined },
      { kind: "separator" },
      { kind: "item", id: "mesoscale-export-molx", text: "Export Mol* state (.molx)", action: () => run({ type: "exportState", format: "molx" }) },
      { kind: "item", id: "mesoscale-export-molj", text: "Export Mol* JSON (.molj)", action: () => run({ type: "exportState", format: "molj" }) },
    ], { x: rect.right, y: rect.bottom + 6 }, { forceWeb: true });
  };

  return (
    <aside className="mesoscale-scene-overlay" aria-label="Mesoscale scene">
      <header className="mesoscale-scene-overlay-header">
        <Layers3 size={15} aria-hidden="true" />
        <span>Scene</span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!(summary?.history?.canUndo ?? false)}
          aria-label="Undo"
          title="Undo"
          onClick={() => run({ type: "undo" })}
        >
          <Undo2 size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!(summary?.history?.canRedo ?? false)}
          aria-label="Redo"
          title="Redo"
          onClick={() => run({ type: "redo" })}
        >
          <Redo2 size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={hoverDimming}
          aria-label={hoverDimming ? "Keep other structures colored on hover" : "Fade other structures on hover"}
          title={hoverDimming ? "Hover fades the rest" : "Hover keeps colors"}
          onClick={() => run({ type: "setHoverDimming", enabled: !hoverDimming })}
        >
          <Contrast size={15} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Scene actions" title="Scene actions" onClick={openSceneMenu}>
          <MoreHorizontal size={15} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close scene" title="Close scene" onClick={onClose}>
          <X size={14} />
        </Button>
      </header>
      <div className="mesoscale-scene-overlay-body">
        <MesoscaleScenePanel document={document} />
      </div>
    </aside>
  );
}

export function MesoscaleSceneToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={`mesoscale-scene-toggle${open ? " active" : ""}`}
      aria-label={open ? "Close scene" : "Open scene"}
      title={open ? "Close scene" : "Open scene"}
      aria-pressed={open}
      onClick={onToggle}
    >
      <Layers3 size={16} />
    </Button>
  );
}
