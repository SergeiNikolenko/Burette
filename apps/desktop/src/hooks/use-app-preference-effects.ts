import { useEffect, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import type { MoleculeTab } from "../stores/molecule-store";
import type { OpenDocumentsResult, ViewerPreferences } from "../types";

type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenDocuments = (paths: string[]) => Promise<OpenDocumentsResult | null | undefined>;

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
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("sync_viewer_preferences", { preferences }).catch((error) => {
      pushErrorStatus(error, "Preview preference sync failed");
    });
  }, [preferences, pushErrorStatus]);

  useEffect(() => {
    if (skipNextPreferenceRefreshRef.current) {
      skipNextPreferenceRefreshRef.current = false;
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
