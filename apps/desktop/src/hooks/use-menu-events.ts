import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";
import { dispatchWorkspaceHistoryCommand } from "../lib/workspace-history-dispatch";
import type { ShellActions } from "../components/types";

const MENU_UNDO_EVENT = "menu:undo";
const MENU_REDO_EVENT = "menu:redo";
const MENU_OPEN_SETTINGS_EVENT = "menu:open-settings";
const MENU_OPEN_FILES_EVENT = "menu:open-files";
const MENU_OPEN_RECENT_EVENT = "menu:open-recent";
const MENU_SAVE_SOURCE_EVENT = "menu:save-source";
const MENU_REVEAL_ACTIVE_EVENT = "menu:reveal-active";
const MENU_COPY_ACTIVE_PATH_EVENT = "menu:copy-active-path";
const MENU_SHOW_ACTIVE_METADATA_EVENT = "menu:show-active-metadata";
const MENU_EXPORT_PREVIEW_PNG_EVENT = "menu:export-preview-png";
const MENU_EXPORT_PREVIEW_SVG_EVENT = "menu:export-preview-svg";
const MENU_CLEAR_PREVIEW_CACHE_EVENT = "menu:clear-preview-cache";
const MENU_RESET_QUICK_LOOK_EVENT = "menu:reset-quick-look";
const MENU_OPEN_LOGS_EVENT = "menu:open-logs";
const MENU_CHECK_UPDATES_EVENT = "menu:check-updates";

export function useMenuEvents({
  actions,
  chooseFiles,
  openMostRecentStructure,
  revealActiveDocument,
  copyActiveDocumentPath,
  showActiveDocumentMetadata,
  exportActivePreviewAsPng,
  exportActivePreviewAsSvg,
  clearCache,
  resetQuickLook,
  openLogs,
  openSettings,
  checkForUpdates,
  saveSource,
}: {
  actions: ShellActions;
  chooseFiles: () => void | Promise<void>;
  openMostRecentStructure: () => void | Promise<void>;
  revealActiveDocument: () => void | Promise<void>;
  copyActiveDocumentPath: () => void | Promise<void>;
  showActiveDocumentMetadata: () => void | Promise<void>;
  exportActivePreviewAsPng: () => void | Promise<void>;
  exportActivePreviewAsSvg: () => void | Promise<void>;
  clearCache: () => void | Promise<void>;
  resetQuickLook: () => void | Promise<void>;
  openLogs: () => void | Promise<void>;
  openSettings: () => void;
  checkForUpdates: () => void | Promise<void>;
  saveSource: () => void | Promise<void>;
}) {
  const handlersRef = useRef({
    actions,
    chooseFiles,
    openMostRecentStructure,
    revealActiveDocument,
    copyActiveDocumentPath,
    showActiveDocumentMetadata,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    clearCache,
    resetQuickLook,
    openLogs,
    openSettings,
    checkForUpdates,
    saveSource,
  });

  useEffect(() => {
    handlersRef.current = {
      actions,
      chooseFiles,
      openMostRecentStructure,
      revealActiveDocument,
      copyActiveDocumentPath,
      showActiveDocumentMetadata,
      exportActivePreviewAsPng,
      exportActivePreviewAsSvg,
      clearCache,
      resetQuickLook,
      openLogs,
      openSettings,
      checkForUpdates,
      saveSource,
    };
  }, [
    actions,
    checkForUpdates,
    chooseFiles,
    clearCache,
    copyActiveDocumentPath,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    openLogs,
    openMostRecentStructure,
    openSettings,
    resetQuickLook,
    revealActiveDocument,
    showActiveDocumentMetadata,
    saveSource,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    const cleanups = [
      trackTauriListener(listen(MENU_UNDO_EVENT, () => {
        void dispatchWorkspaceHistoryCommand("undo", handlersRef.current.actions);
      }), MENU_UNDO_EVENT),
      trackTauriListener(listen(MENU_REDO_EVENT, () => {
        void dispatchWorkspaceHistoryCommand("redo", handlersRef.current.actions);
      }), MENU_REDO_EVENT),
      trackTauriListener(listen(MENU_OPEN_SETTINGS_EVENT, () => {
        handlersRef.current.openSettings();
      }), MENU_OPEN_SETTINGS_EVENT),
      trackTauriListener(listen(MENU_OPEN_FILES_EVENT, () => {
        void handlersRef.current.chooseFiles();
      }), MENU_OPEN_FILES_EVENT),
      trackTauriListener(listen(MENU_OPEN_RECENT_EVENT, () => {
        void handlersRef.current.openMostRecentStructure();
      }), MENU_OPEN_RECENT_EVENT),
      trackTauriListener(listen(MENU_SAVE_SOURCE_EVENT, () => {
        void handlersRef.current.saveSource();
      }), MENU_SAVE_SOURCE_EVENT),
      trackTauriListener(listen(MENU_REVEAL_ACTIVE_EVENT, () => {
        void handlersRef.current.revealActiveDocument();
      }), MENU_REVEAL_ACTIVE_EVENT),
      trackTauriListener(listen(MENU_COPY_ACTIVE_PATH_EVENT, () => {
        void handlersRef.current.copyActiveDocumentPath();
      }), MENU_COPY_ACTIVE_PATH_EVENT),
      trackTauriListener(listen(MENU_SHOW_ACTIVE_METADATA_EVENT, () => {
        void handlersRef.current.showActiveDocumentMetadata();
      }), MENU_SHOW_ACTIVE_METADATA_EVENT),
      trackTauriListener(listen(MENU_EXPORT_PREVIEW_PNG_EVENT, () => {
        void handlersRef.current.exportActivePreviewAsPng();
      }), MENU_EXPORT_PREVIEW_PNG_EVENT),
      trackTauriListener(listen(MENU_EXPORT_PREVIEW_SVG_EVENT, () => {
        void handlersRef.current.exportActivePreviewAsSvg();
      }), MENU_EXPORT_PREVIEW_SVG_EVENT),
      trackTauriListener(listen(MENU_CLEAR_PREVIEW_CACHE_EVENT, () => {
        void handlersRef.current.clearCache();
      }), MENU_CLEAR_PREVIEW_CACHE_EVENT),
      trackTauriListener(listen(MENU_RESET_QUICK_LOOK_EVENT, () => {
        void handlersRef.current.resetQuickLook();
      }), MENU_RESET_QUICK_LOOK_EVENT),
      trackTauriListener(listen(MENU_OPEN_LOGS_EVENT, () => {
        void handlersRef.current.openLogs();
      }), MENU_OPEN_LOGS_EVENT),
      trackTauriListener(listen(MENU_CHECK_UPDATES_EVENT, () => {
        void handlersRef.current.checkForUpdates();
      }), MENU_CHECK_UPDATES_EVENT),
    ];

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
}
