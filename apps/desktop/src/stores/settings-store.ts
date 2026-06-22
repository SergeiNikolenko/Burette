import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewerPreferences } from "../types";

type SettingsState = {
  preferences: ViewerPreferences;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
};

const systemFont = "-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, \"Apple Color Emoji\", Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\"";

export const defaultPreferences: ViewerPreferences = {
  theme: "auto",
  canvasBackground: "auto",
  openInDefaultDestination: "finder",
  rendererMode: "auto",
  molstarStyle: "illustrative",
  conformerEngine: "rdkit",
  conformerCandidateCount: 128,
  conformerRmsdCutoff: 0.75,
  themeLightAccent: "#AF52DE",
  themeLightBackground: "#FFFFFF",
  themeLightForeground: "#0D0D0D",
  themeLightUiFont: systemFont,
  themeLightEditorFont: systemFont,
  themeLightTranslucent: 30,
  themeLightContrast: 20,
  themeDarkAccent: "#AF52DE",
  themeDarkBackground: "#111111",
  themeDarkForeground: "#FCFCFC",
  themeDarkUiFont: systemFont,
  themeDarkEditorFont: systemFont,
  themeDarkTranslucent: 20,
  themeDarkContrast: 16,
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
