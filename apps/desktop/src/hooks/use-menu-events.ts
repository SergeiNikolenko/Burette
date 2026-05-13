import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/tauri";

const MENU_OPEN_SETTINGS_EVENT = "menu:open-settings";
const MENU_OPEN_FILES_EVENT = "menu:open-files";
const MENU_CHECK_UPDATES_EVENT = "menu:check-updates";

export function useMenuEvents({
  chooseFiles,
  openSettings,
  checkForUpdates,
}: {
  chooseFiles: () => void | Promise<void>;
  openSettings: () => void;
  checkForUpdates: () => void | Promise<void>;
}) {
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let unlistenSettings: (() => void) | undefined;
    let unlistenOpenFiles: (() => void) | undefined;
    let unlistenCheckUpdates: (() => void) | undefined;

    void listen(MENU_OPEN_SETTINGS_EVENT, openSettings).then((next) => {
      unlistenSettings = next;
    });
    void listen(MENU_OPEN_FILES_EVENT, () => {
      void chooseFiles();
    }).then((next) => {
      unlistenOpenFiles = next;
    });
    void listen(MENU_CHECK_UPDATES_EVENT, () => {
      void checkForUpdates();
    }).then((next) => {
      unlistenCheckUpdates = next;
    });

    return () => {
      unlistenSettings?.();
      unlistenOpenFiles?.();
      unlistenCheckUpdates?.();
    };
  }, [checkForUpdates, chooseFiles, openSettings]);
}
