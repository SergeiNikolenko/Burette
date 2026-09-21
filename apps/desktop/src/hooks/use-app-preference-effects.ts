import { useEffect, useRef, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
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
      else for (const path of openPaths) pendingPaths.add(path);
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
