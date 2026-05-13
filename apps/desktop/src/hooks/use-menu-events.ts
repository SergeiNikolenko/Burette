import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/runtime";

export const MENU_OPEN_PREFERENCES_EVENT = "menu:open-preferences";
export const MENU_CHECK_UPDATES_EVENT = "menu:check-updates";

type MenuEventHandlers = {
  openSettings: () => void;
  checkForUpdates: () => void | Promise<void>;
};

export function useMenuEvents(handlers: MenuEventHandlers) {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const subscriptions = [
      listen(MENU_OPEN_PREFERENCES_EVENT, handlers.openSettings),
      listen(MENU_CHECK_UPDATES_EVENT, () => {
        void handlers.checkForUpdates();
      }),
    ];

    return () => {
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten());
      }
    };
  }, [handlers.checkForUpdates, handlers.openSettings]);
}
