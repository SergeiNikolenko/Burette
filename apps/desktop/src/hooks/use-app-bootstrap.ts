import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { UpdateState } from "../update";
import { defaultBuildInfo, loadBuildInfo } from "../lib/build-info";
import { markPerformanceOnce } from "../lib/performance";

export function useAppBootstrap(setUpdate: Dispatch<SetStateAction<UpdateState>>) {
  const [buildInfo, setBuildInfo] = useState(defaultBuildInfo);
  const [buildInfoLoaded, setBuildInfoLoaded] = useState(false);

  useEffect(() => {
    window.__BURRETE_BOOT_OVERLAY__?.markMounted();
    const frame = window.requestAnimationFrame(() => {
      markPerformanceOnce("app:shell-visible");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadBuildInfo().then((info) => {
      if (cancelled) return;
      setBuildInfo(info);
      setBuildInfoLoaded(true);
      if (info.isDevBuild) {
        setUpdate((previous) => ({
          ...previous,
          isChecking: false,
          availableRelease: null,
          statusText: info.isBrowserDev ? "Updates are disabled in browser sessions." : "Updates are disabled for dev builds.",
        }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setUpdate]);

  return { buildInfo, buildInfoLoaded };
}
