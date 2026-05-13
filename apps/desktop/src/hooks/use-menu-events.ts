import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/tauri";

const MENU_OPEN_SETTINGS_EVENT = "menu:open-settings";
const MENU_OPEN_FILES_EVENT = "menu:open-files";

export function useMenuEvents({
  chooseFiles,
  openSettings,
}: {
  chooseFiles: () => void | Promise<void>;
  openSettings: () => void;
}) {
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let unlistenSettings: (() => void) | undefined;
    let unlistenOpenFiles: (() => void) | undefined;

    void listen(MENU_OPEN_SETTINGS_EVENT, openSettings).then((next) => {
      unlistenSettings = next;
    });
    void listen(MENU_OPEN_FILES_EVENT, () => {
      void chooseFiles();
    }).then((next) => {
      unlistenOpenFiles = next;
    });

    return () => {
      unlistenSettings?.();
      unlistenOpenFiles?.();
    };
  }, [chooseFiles, openSettings]);
}
