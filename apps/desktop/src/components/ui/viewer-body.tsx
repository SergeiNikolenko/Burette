"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";
import { cn } from "@/lib/utils";

import {
  createViewerStateAttributes,
  readViewerElementSize,
  useOptionalViewerSidebarRegistration,
  useViewerDevelopmentLayoutWarning,
} from "./viewer-internals";
import { useOptionalViewerSidebar } from "./viewer-root";
import { warnViewerDevelopmentOnce } from "./viewer-diagnostics";
import type { ViewerBodyProps } from "./viewer-types";

export function ViewerBody({ className, ...props }: ViewerBodyProps) {
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const [bodyElement, setBodyElement] = React.useState<HTMLDivElement | null>(
    null,
  );
  const sidebarState = useOptionalViewerSidebar();
  const sidebarRegistration = useOptionalViewerSidebarRegistration();
  const namespacedBodyStateAttributes = createViewerStateAttributes(
    sidebarRegistration?.stateNamespace,
    "body",
    {
      hasSidebar: sidebarRegistration?.hasSidebar === true,
      sidebarMode: sidebarState?.mode,
      sidebarOpen: sidebarState?.open,
      sidebarSide: sidebarRegistration?.sidebarSide,
      sidebarState: sidebarState?.state,
    },
  );

  useViewerDevelopmentLayoutWarning({
    enabled: Boolean(sidebarRegistration),
    elements: () => [
      sidebarRegistration?.getRootElement() ?? null,
      bodyRef.current,
    ],
    inspect: () => {
      const rootElement = sidebarRegistration?.getRootElement() ?? null;
      const bodyElement = bodyRef.current;
      const rootSize = readViewerElementSize(rootElement);
      const bodySize = readViewerElementSize(bodyElement);

      if (rootSize.width > 0 && bodySize.width === 0) {
        warnViewerDevelopmentOnce({
          code: "viewer_body_zero_width",
          message:
            "viewer root has nonzero width but viewer body width is zero.",
          rootId: sidebarRegistration?.rootId ?? "unknown-root",
          details: {
            bodyHeight: bodySize.height,
            bodySlot: bodyElement?.dataset.slot,
            bodyWidth: bodySize.width,
            rootHeight: rootSize.height,
            rootSlot: rootElement?.dataset.slot,
            rootWidth: rootSize.width,
          },
        });
      }
    },
    keyParts: [
      "viewer-body-zero-width",
      sidebarRegistration?.rootId,
      sidebarRegistration?.getRootElement(),
      bodyRef.current,
    ],
  });
  const setBodyRef = React.useCallback((element: HTMLDivElement | null) => {
    bodyRef.current = element;
    setBodyElement(element);
  }, []);

  useKeyedLayoutEffect(
    bodyElement && sidebarRegistration
      ? joinEffectKey([
          "viewer-body:register-geometry",
          bodyElement,
          sidebarRegistration.registerBody,
        ])
      : null,
    () => {
      if (!bodyElement || !sidebarRegistration) return;
      return sidebarRegistration.registerBody(bodyElement);
    },
  );

  return (
    <div
      ref={setBodyRef}
      data-slot="viewer-body"
      data-viewer-has-sidebar={
        sidebarRegistration?.hasSidebar === true ? "true" : "false"
      }
      data-viewer-sidebar-mode={sidebarState?.mode}
      data-viewer-sidebar-open={
        sidebarState ? (sidebarState.open ? "true" : "false") : undefined
      }
      data-viewer-sidebar-side={sidebarRegistration?.sidebarSide}
      data-viewer-sidebar-state={sidebarState?.state}
      data-viewer-slot="body"
      {...namespacedBodyStateAttributes}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}
