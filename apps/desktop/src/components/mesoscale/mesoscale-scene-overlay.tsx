import { useEffect } from "react";
import { Layers3, X } from "lucide-react";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { MesoscaleScenePanel } from "./mesoscale-scene-panel";

export function MesoscaleSceneOverlay({ document, onClose }: { document: ViewerDocument; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside className="mesoscale-scene-overlay" aria-label="Mesoscale scene">
      <header className="mesoscale-scene-overlay-header">
        <Layers3 size={15} aria-hidden="true" />
        <span>Scene</span>
        <small>{document.title}</small>
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
