// Coalesces the values a pointer drag reports every frame into one commit.
//
// Persisting a dragged panel size straight from the layout callback wrote the
// store (and, through zustand's persist middleware, localStorage) once per
// frame of the gesture. Outside a drag every report commits immediately, so
// keyboard resizes and programmatic layout changes keep their old semantics;
// inside one the latest value is parked and committed once when the drag ends.

export type DragCommit<T> = {
  begin: () => void;
  report: (value: T) => void;
  end: () => void;
  isDragging: () => boolean;
};

export function createDragCommit<T>(commit: (value: T) => void): DragCommit<T> {
  let dragging = false;
  let hasPending = false;
  let pending: T | undefined;
  return {
    begin: () => {
      dragging = true;
    },
    report: (value) => {
      if (!dragging) {
        commit(value);
        return;
      }
      pending = value;
      hasPending = true;
    },
    end: () => {
      if (!dragging) return;
      dragging = false;
      if (!hasPending) return;
      hasPending = false;
      const value = pending as T;
      pending = undefined;
      commit(value);
    },
    isDragging: () => dragging,
  };
}
