import { useEffect } from "react";
import type { ViewerDocument } from "../../types";
import { consumeMesoscaleCanvasContextMenu, useMesoscaleStore } from "../../stores/mesoscale-store";
import { showMesoscaleObjectMenu } from "./mesoscale-object-menu";

export function MesoscaleCanvasContextMenu({ document }: { document: ViewerDocument }) {
  const menu = useMesoscaleStore((state) => state.sessions[document.id]?.canvasContextMenu ?? null);
  const selectionVersion = useMesoscaleStore((state) => state.sessions[document.id]?.summary?.selectionVersion);

  useEffect(() => {
    if (!menu) return;
    consumeMesoscaleCanvasContextMenu(document.id, menu.token);
    void showMesoscaleObjectMenu(document.id, menu.item, menu.selectedCount, { x: menu.x, y: menu.y }, selectionVersion);
  }, [document.id, menu, selectionVersion]);

  return null;
}
