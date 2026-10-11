import { useEffect, useRef, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import { useAppLevelPreferences } from "./use-app-level-preferences";
import { viewerAppearanceMessage } from "../lib/theme";
import type { MoleculeTab } from "../stores/molecule-store";
import type { OpenDocumentsResult, ViewerDocument, ViewerPreferences } from "../types";

type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenDocuments = (paths: string[], reloadOptions?: undefined, preferencesOverride?: undefined, options?: { preserveActiveTab?: boolean; shouldApply?: () => boolean }) => Promise<OpenDocumentsResult | null | undefined>;

// Preferences the mounted viewers can apply without being rebuilt, each mapped to
// the runtime message that applies it. Everything else is baked into the viewer
// runtime HTML, so changing it still reopens the document. `theme` qualifies
// because the runtime carries the token sets for both themes; `molstarStyle`
// because the runtime can re-render into any style in place.
const LIVE_APPLIED_PREFERENCE_MESSAGES = {
  theme: "setViewerTheme",
  canvasBackground: "setViewerTheme",
  themeLightAccent: "setViewerTheme",
  themeLightBackground: "setViewerTheme",
  themeLightForeground: "setViewerTheme",
  themeLightUiFont: "setViewerTheme",
  themeLightEditorFont: "setViewerTheme",
  themeLightTranslucent: "setViewerTheme",
  themeLightContrast: "setViewerTheme",
  themeDarkAccent: "setViewerTheme",
  themeDarkBackground: "setViewerTheme",
  themeDarkForeground: "setViewerTheme",
  themeDarkUiFont: "setViewerTheme",
  themeDarkEditorFont: "setViewerTheme",
  themeDarkTranslucent: "setViewerTheme",
  themeDarkContrast: "setViewerTheme",
  molstarStyle: "setViewerStyle",
  // Viewer and grid defaults: open frames adopt them in place.
  screenshotResolution: "setScreenshotResolutionDefault",
  screenshotFormat: "setScreenshotFormatDefault",
  screenshotTransparent: "setScreenshotTransparentDefault",
  gridViewMode: "setGridViewModeDefault",
  gridCardRenderer: "setGridCardRendererDefault",
  gridCardSize: "setGridCardSizeDefault",
  hydrogenDisplay: "setGridHydrogenDisplayDefault",
  // Read only by the Quick Look extension (synced through sync_viewer_preferences).
  quickLookGridSdf: null,
  quickLookGridSmiles: null,
  quickLookGridCsv: null,
  quickLookGridTsv: null,
  // App-level settings applied outside the viewers (useAppLevelPreferences).
  interfaceScale: null,
  restoreSessionOnLaunch: null,
  notifyOnJobCompletion: null,
  preventSleepDuringJobs: null,
  computeBackend: null,
  jobHistoryRetentionDays: null,
  pythonPath: null,
  uvPath: null,
} as const satisfies Partial<Record<keyof ViewerPreferences, string | null>>;

type LiveAppliedPreferenceKey = keyof typeof LIVE_APPLIED_PREFERENCE_MESSAGES;

function changedLiveAppliedKeys(previous: ViewerPreferences, next: ViewerPreferences) {
  const changed: LiveAppliedPreferenceKey[] = [];
  for (const key of Object.keys(next) as (keyof ViewerPreferences)[]) {
    if (previous[key] === next[key]) continue;
    if (!(key in LIVE_APPLIED_PREFERENCE_MESSAGES)) return null;
    changed.push(key as LiveAppliedPreferenceKey);
  }
  return changed.length ? changed : null;
}

function broadcastLiveAppliedPreferences(keys: LiveAppliedPreferenceKey[], preferences: ViewerPreferences) {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe[data-document-id]")) {
    const sent = new Set<string>();
    for (const key of keys) {
      const type = LIVE_APPLIED_PREFERENCE_MESSAGES[key];
      if (!type || sent.has(type)) continue;
      sent.add(type);
      frame.contentWindow?.postMessage({
        source: "burette-host",
        body: type === "setViewerTheme" ? viewerAppearanceMessage(preferences) : { type, value: preferences[key] },
      }, "*");
    }
  }
}

type UseAppPreferenceEffectsOptions = {
  activeTab: MoleculeTab | null | undefined;
  activeTabId: string | null;
  documents: ViewerDocument[];
  isDocumentDirty: (document: ViewerDocument) => boolean;
  openDocuments: OpenDocuments;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  skipNextPreferenceRefreshRef: MutableRefObject<boolean>;
};

export function useAppPreferenceEffects({
  activeTab,
  activeTabId,
  documents,
  isDocumentDirty,
  openDocuments,
  preferences,
  pushErrorStatus,
  skipNextPreferenceRefreshRef,
}: UseAppPreferenceEffectsOptions) {
  const previousPreferencesRef = useRef(preferences);
  const pendingPathsRef = useRef(new Set<string>());
  const currentInputsRef = useRef({ documents, preferences, isDocumentDirty });
  currentInputsRef.current = { documents, preferences, isDocumentDirty };
  useAppLevelPreferences(preferences, pushErrorStatus);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("sync_viewer_preferences", { preferences }).catch((error) => {
      pushErrorStatus(error, "Preview preference sync failed");
    });
  }, [preferences, pushErrorStatus]);

  useEffect(() => {
    const previousPreferences = previousPreferencesRef.current;
    previousPreferencesRef.current = preferences;
    const pendingPaths = pendingPathsRef.current;
    const openPaths = new Set(documents.map((document) => document.path));
    for (const path of pendingPaths) {
      if (!openPaths.has(path)) pendingPaths.delete(path);
    }
    if (previousPreferences !== preferences) {
      if (skipNextPreferenceRefreshRef.current) {
        skipNextPreferenceRefreshRef.current = false;
        return;
      }
      // Live changes preserve scenes; HTML-backed changes wait for activation.
      const liveKeys = changedLiveAppliedKeys(previousPreferences, preferences);
      if (liveKeys) broadcastLiveAppliedPreferences(liveKeys, preferences);
      else {
        // A settings import may mix appearance and document-only changes. Dirty
        // scenes still receive the appearance without losing their edits.
        if (JSON.stringify(viewerAppearanceMessage(previousPreferences)) !== JSON.stringify(viewerAppearanceMessage(preferences))) {
          broadcastLiveAppliedPreferences(["theme"], preferences);
        }
        for (const path of openPaths) pendingPaths.add(path);
      }
    }
    const path = activeTab?.location.kind === "file" && !isTemporaryDocumentPath(activeTab.location.path)
      ? activeTab.location.path
      : null;
    if (!path || !pendingPaths.has(path)) return;
    const document = documents.find((candidate) => candidate.path === path);
    if (!document || isDocumentDirty(document)) return;
    pendingPaths.delete(path);
    let deferred = false;
    void openDocuments([path], undefined, undefined, {
      preserveActiveTab: true,
      shouldApply: () => {
        const current = currentInputsRef.current;
        if (current.preferences !== preferences || !current.documents.includes(document)) return false;
        deferred = current.isDocumentDirty(document);
        return !deferred;
      },
    }).then(() => {
      if (deferred) pendingPaths.add(path);
    });
  }, [activeTab, activeTabId, documents, isDocumentDirty, openDocuments, preferences, skipNextPreferenceRefreshRef]);
}
