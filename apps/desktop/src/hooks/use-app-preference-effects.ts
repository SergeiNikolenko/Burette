import { useEffect, useRef, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import type { MoleculeTab } from "../stores/molecule-store";
import type { OpenDocumentsResult, ViewerPreferences } from "../types";

type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenDocuments = (paths: string[]) => Promise<OpenDocumentsResult | null | undefined>;

// Preferences the mounted viewers can apply without being rebuilt, each mapped to
// the runtime message that applies it. Everything else is baked into the viewer
// runtime HTML, so changing it still reopens the document. `theme` qualifies
// because the runtime carries the token sets for both themes; `molstarStyle`
// because the runtime can re-render into any style in place.
const LIVE_APPLIED_PREFERENCE_MESSAGES = {
  theme: "setViewerTheme",
  molstarStyle: "setViewerStyle",
} as const satisfies Partial<Record<keyof ViewerPreferences, string>>;

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
    for (const key of keys) {
      frame.contentWindow?.postMessage({
        source: "burette-host",
        body: { type: LIVE_APPLIED_PREFERENCE_MESSAGES[key], value: preferences[key] },
      }, "*");
    }
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
    const liveKeys = changedLiveAppliedKeys(previousPreferences, preferences);
    if (liveKeys) {
      broadcastLiveAppliedPreferences(liveKeys, preferences);
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
