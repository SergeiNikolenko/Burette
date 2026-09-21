export type MesoscaleCanvasPoint = { x: number; y: number };

type SelectionMode = "replace" | "extend";

type MesoscaleCanvasInteractionOptions = {
  pick: (point: MesoscaleCanvasPoint) => string | null;
  select: (ref: string, mode: SelectionMode) => void;
  isSelected: (ref: string) => boolean;
  openContextMenu: (ref: string, point: MesoscaleCanvasPoint) => void;
};

export function shouldClearMesoscaleSelectionOnMiss(started: boolean, extend: boolean) {
  return !started && !extend;
}

export function createMesoscaleCanvasInteractionController(options: MesoscaleCanvasInteractionOptions) {
  let active = false;
  let visited = new Set<string>();
  let nextMode: SelectionMode = "replace";

  const selectOnce = (ref: string, mode: SelectionMode) => {
    if (visited.has(ref)) return;
    visited.add(ref);
    options.select(ref, mode);
  };

  return {
    get active() { return active; },

    pointerDown(button: number, point: MesoscaleCanvasPoint, extend: boolean) {
      if (button !== 0) return false;
      active = true;
      visited = new Set();
      nextMode = extend ? "extend" : "replace";
      const ref = options.pick(point);
      if (!ref) return false;
      selectOnce(ref, nextMode);
      nextMode = "extend";
      return true;
    },

    pointerMove(point: MesoscaleCanvasPoint) {
      if (!active) return false;
      const ref = options.pick(point);
      if (ref) {
        selectOnce(ref, nextMode);
        nextMode = "extend";
      }
      return true;
    },

    pointerUp() {
      if (!active) return false;
      active = false;
      visited.clear();
      return true;
    },

    contextMenuFor(ref: string, point: MesoscaleCanvasPoint) {
      if (!options.isSelected(ref)) options.select(ref, "replace");
      options.openContextMenu(ref, point);
      return true;
    },

    contextMenu(point: MesoscaleCanvasPoint) {
      const ref = options.pick(point);
      return ref ? this.contextMenuFor(ref, point) : false;
    },
  };
}
