import { useUIStore } from "../stores/ui-store";

export type { CommandPaletteIntent } from "../stores/ui-store";

export function useIsCommandPaletteOpen() {
  return useUIStore((state) => state.isCommandPaletteOpen);
}

export function useCommandPaletteSearch() {
  return useUIStore((state) => state.commandPaletteSearch);
}

export function useOpenCommandPalette() {
  return useUIStore((state) => state.openCommandPalette);
}

export function useCloseCommandPalette() {
  return useUIStore((state) => state.closeCommandPalette);
}

export function useSetCommandPaletteSearch() {
  return useUIStore((state) => state.setCommandPaletteSearch);
}
