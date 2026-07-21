import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { isTauriRuntime } from "../lib/tauri";

const BROWSER_DEFAULT_APPLICATION_ICON_URL = "/__burette/app-icon/default-app.png";

export function useDefaultApplicationIconUrl(path: string | null) {
  const [iconUrl, setIconUrl] = useState<string | null>(() => (
    !isTauriRuntime() ? BROWSER_DEFAULT_APPLICATION_ICON_URL : null
  ));

  useEffect(() => {
    if (!isTauriRuntime()) {
      setIconUrl(BROWSER_DEFAULT_APPLICATION_ICON_URL);
      return;
    }
    if (!path) return;
    let cancelled = false;
    setIconUrl(null);
    void invoke<string | null>("default_application_icon_path", { path })
      .then((iconPath) => {
        if (!cancelled) setIconUrl(iconPath ? convertFileSrc(iconPath) : null);
      })
      .catch(() => {
        if (!cancelled) setIconUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return iconUrl;
}
