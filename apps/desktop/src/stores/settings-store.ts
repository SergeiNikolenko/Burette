import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewerPreferences } from "../types";

type SettingsState = {
  preferences: ViewerPreferences;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
  restoreSnapshot: (snapshot: SettingsStoreSnapshot) => void;
};

export type SettingsStoreSnapshot = {
  preferences: ViewerPreferences;
};

const systemFont = "-apple-system-body, ui-sans-serif, -apple-system, system-ui, \"Segoe UI\", Helvetica, \"Apple Color Emoji\", Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\"";

export const defaultPreferences: ViewerPreferences = {
  theme: "auto",
  canvasBackground: "auto",
  openInDefaultDestination: "finder",
  rendererMode: "auto",
  molstarStyle: "illustrative",
  desktopPreviewLimitMiB: 1024,
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getSettingsStoreSnapshot(): SettingsStoreSnapshot {
  const state = useSettingsStore.getState();
  return cloneJson({ preferences: state.preferences });
}

type PersistedSettingsState = Pick<SettingsState, "preferences">;

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], PersistedSettingsState>(
	    (set) => ({
	      preferences: defaultPreferences,
	      setPreference: (key, value) => set((state) => ({ preferences: { ...state.preferences, [key]: value } })),
	      restoreSnapshot: (snapshot) => set({ preferences: cloneJson(snapshot.preferences) }),
	    }),
    {
      name: "burrete.shell",
      partialize: (state) => ({
        preferences: state.preferences,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedSettingsState> | undefined;
        const storedPreferences = stored?.preferences ?? {};
        return {
          ...current,
          preferences: {
            ...current.preferences,
            ...storedPreferences,
            desktopPreviewLimitMiB: normalizeDesktopPreviewLimitMiB(
              (storedPreferences as Partial<ViewerPreferences>).desktopPreviewLimitMiB,
            ),
          },
        };
      },
    },
  ),
);

function normalizeDesktopPreviewLimitMiB(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(Math.max(value, 1), 4096))
    : defaultPreferences.desktopPreviewLimitMiB;
}
