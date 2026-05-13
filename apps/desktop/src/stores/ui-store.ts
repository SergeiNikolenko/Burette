import { create } from "zustand";

export type CommandPaletteIntent = "default" | "search" | "recent-files" | "create-file";

interface UIState {
  isCommandPaletteOpen: boolean;
  commandPaletteIntent: CommandPaletteIntent;
  commandPaletteSearch: string;
  openCommandPalette: (intent?: CommandPaletteIntent) => void;
  closeCommandPalette: () => void;
  setCommandPaletteSearch: (search: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isCommandPaletteOpen: false,
  commandPaletteIntent: "default",
  commandPaletteSearch: "",
  openCommandPalette: (intent = "default") =>
    set({ isCommandPaletteOpen: true, commandPaletteIntent: intent, commandPaletteSearch: "" }),
  closeCommandPalette: () =>
    set({
      isCommandPaletteOpen: false,
      commandPaletteIntent: "default",
      commandPaletteSearch: "",
    }),
  setCommandPaletteSearch: (search) => set({ commandPaletteSearch: search }),
}));
