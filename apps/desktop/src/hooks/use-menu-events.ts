import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/tauri";

const MENU_OPEN_SETTINGS_EVENT = "menu:open-settings";
const MENU_OPEN_FILES_EVENT = "menu:open-files";
const MENU_OPEN_RECENT_EVENT = "menu:open-recent";
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
}: {
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
}) {
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let unlistenSettings: (() => void) | undefined;
    let unlistenOpenFiles: (() => void) | undefined;
    let unlistenOpenRecent: (() => void) | undefined;
    let unlistenRevealActive: (() => void) | undefined;
    let unlistenCopyActivePath: (() => void) | undefined;
    let unlistenShowActiveMetadata: (() => void) | undefined;
    let unlistenExportPreviewPng: (() => void) | undefined;
    let unlistenExportPreviewSvg: (() => void) | undefined;
    let unlistenClearPreviewCache: (() => void) | undefined;
    let unlistenResetQuickLook: (() => void) | undefined;
    let unlistenOpenLogs: (() => void) | undefined;
    let unlistenCheckUpdates: (() => void) | undefined;

    void listen(MENU_OPEN_SETTINGS_EVENT, openSettings).then((next) => {
      unlistenSettings = next;
    });
    void listen(MENU_OPEN_FILES_EVENT, () => {
      void chooseFiles();
    }).then((next) => {
      unlistenOpenFiles = next;
    });
    void listen(MENU_OPEN_RECENT_EVENT, () => {
      void openMostRecentStructure();
    }).then((next) => {
      unlistenOpenRecent = next;
    });
    void listen(MENU_REVEAL_ACTIVE_EVENT, () => {
      void revealActiveDocument();
    }).then((next) => {
      unlistenRevealActive = next;
    });
    void listen(MENU_COPY_ACTIVE_PATH_EVENT, () => {
      void copyActiveDocumentPath();
    }).then((next) => {
      unlistenCopyActivePath = next;
    });
    void listen(MENU_SHOW_ACTIVE_METADATA_EVENT, () => {
      void showActiveDocumentMetadata();
    }).then((next) => {
      unlistenShowActiveMetadata = next;
    });
    void listen(MENU_EXPORT_PREVIEW_PNG_EVENT, () => {
      void exportActivePreviewAsPng();
    }).then((next) => {
      unlistenExportPreviewPng = next;
    });
    void listen(MENU_EXPORT_PREVIEW_SVG_EVENT, () => {
      void exportActivePreviewAsSvg();
    }).then((next) => {
      unlistenExportPreviewSvg = next;
    });
    void listen(MENU_CLEAR_PREVIEW_CACHE_EVENT, () => {
      void clearCache();
    }).then((next) => {
      unlistenClearPreviewCache = next;
    });
    void listen(MENU_RESET_QUICK_LOOK_EVENT, () => {
      void resetQuickLook();
    }).then((next) => {
      unlistenResetQuickLook = next;
    });
    void listen(MENU_OPEN_LOGS_EVENT, () => {
      void openLogs();
    }).then((next) => {
      unlistenOpenLogs = next;
    });
    void listen(MENU_CHECK_UPDATES_EVENT, () => {
      void checkForUpdates();
    }).then((next) => {
      unlistenCheckUpdates = next;
    });

    return () => {
      unlistenSettings?.();
      unlistenOpenFiles?.();
      unlistenOpenRecent?.();
      unlistenRevealActive?.();
      unlistenCopyActivePath?.();
      unlistenShowActiveMetadata?.();
      unlistenExportPreviewPng?.();
      unlistenExportPreviewSvg?.();
      unlistenClearPreviewCache?.();
      unlistenResetQuickLook?.();
      unlistenOpenLogs?.();
      unlistenCheckUpdates?.();
    };
  }, [
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
  ]);
}
