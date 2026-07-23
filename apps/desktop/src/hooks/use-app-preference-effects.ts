import { useEffect, useRef, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import type { MoleculeTab } from "../stores/molecule-store";
import type { OpenDocumentsResult, ViewerPreferences } from "../types";

type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenDocuments = (paths: string[]) => Promise<OpenDocumentsResult | null | undefined>;

// Preferences the mounted viewers can apply without being rebuilt. Everything
// else is baked into the viewer runtime HTML, so changing it still reopens the
// document. `theme` qualifies because the runtime already carries the token sets
// for both themes and switches between them at runtime.
const LIVE_APPLIED_PREFERENCE_KEYS = ["theme"] as const satisfies readonly (keyof ViewerPreferences)[];

function onlyLiveAppliedPreferencesChanged(previous: ViewerPreferences, next: ViewerPreferences) {
  const live = new Set<string>(LIVE_APPLIED_PREFERENCE_KEYS);
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  let liveChanged = false;
  for (const key of keys) {
    if (previous[key as keyof ViewerPreferences] === next[key as keyof ViewerPreferences]) continue;
    if (!live.has(key)) return false;
    liveChanged = true;
  }
  return liveChanged;
}

function broadcastViewerTheme(theme: ViewerPreferences["theme"]) {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe[data-document-id]")) {
    frame.contentWindow?.postMessage({
      source: "burrete-host",
      body: { type: "setViewerTheme", value: theme },
    }, "*");
  }
}

type UseAppPreferenceEffectsOptions = {
  activeTab: MoleculeTab | null | undefined;
  activeTabId: string | null;
  openDocuments: OpenDocuments;
  preferences: ViewerPreferences;
  pushErrorStatus: PushErrorStatus;
  setActiveTab: (id: string) => void;
  skipNextPreferenceRefreshRef: MutableRefObject<boolean>;
};

export function useAppPreferenceEffects({
  activeTab,
  activeTabId,
  openDocuments,
  preferences,
  pushErrorStatus,
  setActiveTab,
  skipNextPreferenceRefreshRef,
}: UseAppPreferenceEffectsOptions) {
  const previousPreferencesRef = useRef(preferences);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("sync_viewer_preferences", { preferences }).catch((error) => {
      pushErrorStatus(error, "Preview preference sync failed");
    });
  }, [preferences, pushErrorStatus]);

  useEffect(() => {
    const previousPreferences = previousPreferencesRef.current;
    previousPreferencesRef.current = preferences;
    if (skipNextPreferenceRefreshRef.current) {
      skipNextPreferenceRefreshRef.current = false;
      return;
    }
    // Reopening would drop the live Mol* scene (camera, components, selections),
    // so preferences the mounted viewers can apply themselves are pushed instead.
    if (onlyLiveAppliedPreferencesChanged(previousPreferences, preferences)) {
      broadcastViewerTheme(preferences.theme);
      return;
    }
    const path = activeTab?.location.kind === "file" && !isTemporaryDocumentPath(activeTab.location.path)
      ? activeTab.location.path
      : null;
    if (!path) return;
    const restoreTabId = activeTabId;
    void openDocuments([path]).then(() => {
      if (restoreTabId) setActiveTab(restoreTabId);
    });
    // Preferences refresh only the mounted file runtime. Inactive file tabs are unloaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences]);
}
