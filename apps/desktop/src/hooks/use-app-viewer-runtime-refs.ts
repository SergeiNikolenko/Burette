import { useRef } from "react";

import type { PendingMolstarReplaceResolver } from "./use-app-generate-3d-conformer";
import type { ViewerReloadOptions } from "../types";

export function useAppViewerRuntimeRefs() {
  const pendingViewerReloadOptionsRef = useRef<ViewerReloadOptions | null>(null);
  const pendingViewerReloadDocumentIdRef = useRef<string | null>(null);
  const pendingMolstarReplaceRef = useRef<Map<string, PendingMolstarReplaceResolver>>(new Map());
  const xyzrenderOrientationRefRef = useRef<string | null>(null);
  const skipNextPreferenceRefreshRef = useRef(false);

  return {
    pendingViewerReloadOptionsRef,
    pendingViewerReloadDocumentIdRef,
    pendingMolstarReplaceRef,
    xyzrenderOrientationRefRef,
    skipNextPreferenceRefreshRef,
  };
}
