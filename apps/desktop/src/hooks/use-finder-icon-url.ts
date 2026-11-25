import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { FOLDER_IMAGE_URL } from "../components/menu-icons";
import { isTauriRuntime } from "../lib/tauri";
import { isWebDemoWorkspace } from "../lib/web-demo-workspace";

const BROWSER_DEV_FINDER_ICON_URL = "/__burette/app-icon/finder.png";

export function useFinderIconUrl() {
  const [iconUrl, setIconUrl] = useState<string | null>(() => (
    !isTauriRuntime() ? (isWebDemoWorkspace() ? FOLDER_IMAGE_URL : BROWSER_DEV_FINDER_ICON_URL) : null
  ));

  useEffect(() => {
    if (!isTauriRuntime()) {
      if (isWebDemoWorkspace()) {
        setIconUrl(FOLDER_IMAGE_URL);
        return;
      }
      setIconUrl(BROWSER_DEV_FINDER_ICON_URL);
      return;
    }
    let cancelled = false;
    void invoke<string | null>("finder_icon_path")
      // Only macOS has a Finder icon; elsewhere the shared folder glyph stands in.
      .then((path) => {
        if (!cancelled) setIconUrl(path ? convertFileSrc(path) : FOLDER_IMAGE_URL);
      })
      .catch(() => {
        if (!cancelled) setIconUrl(FOLDER_IMAGE_URL);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return iconUrl;
}
