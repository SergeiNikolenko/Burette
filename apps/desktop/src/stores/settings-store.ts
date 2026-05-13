import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewerPreferences } from "../types";

type SettingsState = {
  preferences: ViewerPreferences;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
};

export const defaultPreferences: ViewerPreferences = {
  theme: "auto",
  canvasBackground: "auto",
  rendererMode: "auto",
  xyzFastStyle: "default",
};

type PersistedSettingsState = Pick<SettingsState, "preferences">;

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], PersistedSettingsState>(
    (set) => ({
      preferences: defaultPreferences,
      setPreference: (key, value) => set((state) => ({ preferences: { ...state.preferences, [key]: value } })),
    }),
    {
      name: "burrete.shell",
      partialize: (state) => ({
        preferences: state.preferences,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedSettingsState> | undefined;
        return {
          ...current,
          preferences: {
            ...current.preferences,
            ...stored?.preferences,
          },
        };
      },
    },
  ),
);
