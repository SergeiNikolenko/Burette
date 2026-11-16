import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../../lib/tauri";

export function useWindowTitle(title: string) {
  useEffect(() => {
    document.title = title;
    if (isTauriRuntime()) {
      void getCurrentWindow().setTitle(title).catch((error) => {
        console.warn("[Burette] Window title update failed", error);
      });
    }
  }, [title]);
}
