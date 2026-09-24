import { create } from "zustand";

// Whether annotate mode is on. The header toggle and ⌘. flip it; the layer
// owns the annotations themselves and drops them when the mode ends.
export const useAnnotationStore = create<{ active: boolean; setActive: (active: boolean) => void; toggle: () => void }>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
  toggle: () => set((state) => ({ active: !state.active })),
}));
