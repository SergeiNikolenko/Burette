import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewerPreferences } from "../types";
import { normalizeShortcutOverrides } from "../lib/keyboard-shortcuts";

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
  interfaceScale: 1,
  restoreSessionOnLaunch: true,
  notifyOnJobCompletion: true,
  preventSleepDuringJobs: true,
  computeBackend: "auto",
  // Existing history stays intact until the user chooses a retention period.
  jobHistoryRetentionDays: 0,
  pythonPath: "",
  uvPath: "",
  screenshotResolution: "viewport",
  screenshotFormat: "png",
  screenshotTransparent: false,
  gridViewMode: "cards",
  gridCardRenderer: "rdkit",
  // 0 keeps the grid's fluid card width; a positive value is a fixed minimum in px.
  gridCardSize: 0,
  hydrogenDisplay: "none",
  quickLookGridSdf: true,
  quickLookGridSmiles: true,
  quickLookGridCsv: true,
  quickLookGridTsv: true,
  shortcutOverrides: {},
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
	      restoreSnapshot: (snapshot) => set({ preferences: normalizePreferences(cloneJson(snapshot.preferences)) }),
	    }),
    {
      name: "burette.shell",
      partialize: (state) => ({
        preferences: state.preferences,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedSettingsState> | undefined;
        const storedPreferences = stored?.preferences ?? {};
        return {
          ...current,
          preferences: normalizePreferences({ ...current.preferences, ...storedPreferences }),
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

function normalizeChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? value as T : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

// Mirrors MIN_CARD_MIN/MAX_CARD_MIN in PreviewExtension/Web/grid-viewer.js.
function normalizeGridCardSize(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(Math.min(Math.max(value, 86), 360));
}

function normalizeViewerDefaults(preferences: ViewerPreferences) {
  const fallback = defaultPreferences;
  preferences.screenshotResolution = normalizeChoice(preferences.screenshotResolution, ["viewport", "hd", "full-hd", "ultra-hd", "8k-ultra-hd"], fallback.screenshotResolution);
  preferences.screenshotFormat = normalizeChoice(preferences.screenshotFormat, ["png", "jpeg", "webp"], fallback.screenshotFormat);
  preferences.screenshotTransparent = normalizeBoolean(preferences.screenshotTransparent, fallback.screenshotTransparent);
  preferences.gridViewMode = normalizeChoice(preferences.gridViewMode, ["cards", "table"], fallback.gridViewMode);
  preferences.gridCardRenderer = normalizeChoice(preferences.gridCardRenderer, ["rdkit", "xyzrender"], fallback.gridCardRenderer);
  preferences.gridCardSize = normalizeGridCardSize(preferences.gridCardSize);
  preferences.hydrogenDisplay = normalizeChoice(preferences.hydrogenDisplay, ["none", "all"], fallback.hydrogenDisplay);
  preferences.quickLookGridSdf = normalizeBoolean(preferences.quickLookGridSdf, fallback.quickLookGridSdf);
  preferences.quickLookGridSmiles = normalizeBoolean(preferences.quickLookGridSmiles, fallback.quickLookGridSmiles);
  preferences.quickLookGridCsv = normalizeBoolean(preferences.quickLookGridCsv, fallback.quickLookGridCsv);
  preferences.quickLookGridTsv = normalizeBoolean(preferences.quickLookGridTsv, fallback.quickLookGridTsv);
}

// Matches the native zoom ladder bounds in src-tauri/src/zoom.rs.
function normalizeInterfaceScale(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, 0.5), 3)
    : defaultPreferences.interfaceScale;
}

function normalizeAppDefaults(preferences: ViewerPreferences) {
  const fallback = defaultPreferences;
  preferences.interfaceScale = normalizeInterfaceScale(preferences.interfaceScale);
  preferences.restoreSessionOnLaunch = normalizeBoolean(preferences.restoreSessionOnLaunch, fallback.restoreSessionOnLaunch);
  preferences.notifyOnJobCompletion = normalizeBoolean(preferences.notifyOnJobCompletion, fallback.notifyOnJobCompletion);
  preferences.preventSleepDuringJobs = normalizeBoolean(preferences.preventSleepDuringJobs, fallback.preventSleepDuringJobs);
  preferences.computeBackend = normalizeChoice(preferences.computeBackend, ["auto", "metal", "cpu"], fallback.computeBackend);
  preferences.jobHistoryRetentionDays = typeof preferences.jobHistoryRetentionDays === "number" && Number.isInteger(preferences.jobHistoryRetentionDays) && preferences.jobHistoryRetentionDays >= 0
    ? preferences.jobHistoryRetentionDays
    : fallback.jobHistoryRetentionDays;
  preferences.pythonPath = typeof preferences.pythonPath === "string" ? preferences.pythonPath : fallback.pythonPath;
  preferences.uvPath = typeof preferences.uvPath === "string" ? preferences.uvPath : fallback.uvPath;
}

function normalizePreferences(preferences: ViewerPreferences): ViewerPreferences {
  // Drop the obsolete engine selector from persisted settings and history snapshots.
  const normalized = { ...preferences } as ViewerPreferences & { conformerEngine?: unknown };
  delete normalized.conformerEngine;
  normalized.desktopPreviewLimitMiB = normalizeDesktopPreviewLimitMiB(normalized.desktopPreviewLimitMiB);
  normalized.shortcutOverrides = normalizeShortcutOverrides(normalized.shortcutOverrides);
  normalizeViewerDefaults(normalized);
  normalizeAppDefaults(normalized);
  return normalized;
}
