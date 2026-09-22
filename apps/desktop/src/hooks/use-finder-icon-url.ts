import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { isTauriRuntime } from "../lib/tauri";

const BROWSER_DEV_FINDER_ICON_URL = "/__burette/app-icon/finder.png";

export function useFinderIconUrl() {
  const [iconUrl, setIconUrl] = useState<string | null>(() => (
    !isTauriRuntime() && (typeof window === "undefined" || !window.BuretteMcpWorkspace)
      ? BROWSER_DEV_FINDER_ICON_URL : null
  ));

  useEffect(() => {
    if (!isTauriRuntime()) {
      setIconUrl(window.BuretteMcpWorkspace ? null : BROWSER_DEV_FINDER_ICON_URL);
      return;
    }
    let cancelled = false;
    void invoke<string | null>("finder_icon_path")
      .then((path) => {
        if (!cancelled && path) setIconUrl(convertFileSrc(path));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return iconUrl;
}
