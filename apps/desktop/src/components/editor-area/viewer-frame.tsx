import { convertFileSrc } from "@tauri-apps/api/core";
import type { Ref, SyntheticEvent } from "react";
import type { ViewerDocument } from "../../types";
import type {
  SourcePreviewFrameSnapshot,
  SourcePreviewIdentity,
  SourcePreviewRuntime,
  SourcePreviewSlot,
} from "../../lib/source-preview/types";
import { isTauriRuntime } from "../../lib/tauri";
import { isHostedMcpWidget } from "../../lib/hosted-mcp-widget";
import { isWebDemoHeroEmbed } from "../../lib/web-demo-workspace";
import { useViewerPreferences } from "../../hooks/use-settings";
import { useDeferredViewerRuntime } from "../../hooks/use-deferred-viewer-runtime";
import { FileViewerLoadingState } from "../ui/file-viewer-state";
import { ViewerErrorState } from "../ui/viewer-error";
import { viewerAppearanceMessage } from "../../lib/theme";
import {
  isGridDocumentCloseTransitionActive,
  replayPendingGridCloseTransitionRequests,
} from "../../lib/window-mutation-barrier";

// Guard pointer ownership, not viewport geometry. Freezing an iframe's pixel
// size leaves its toolbar and camera centered in the old, now-clipped viewport.
// Frames must follow the panels live; each renderer coalesces its resize work.
// Keep the guard reference counted because a drag can overlap a toggle or a
// window resize. An iframe under the pointer must not swallow that gesture.
const framePins = new WeakMap<HTMLElement, { depth: number; restore: () => void }>();

export function pinViewerFrames(root: HTMLElement): () => void {
  let pin = framePins.get(root);
  if (!pin) {
    const resizing = root.getAttribute("data-resizing");
    root.setAttribute("data-resizing", "true");
    pin = { depth: 0, restore: () => {
      if (resizing === null) root.removeAttribute("data-resizing");
      else root.setAttribute("data-resizing", resizing);
    } };
    framePins.set(root, pin);
  }
  pin.depth++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--pin.depth > 0) return;
    pin.restore();
    framePins.delete(root);
  };
}

export function viewerFrameSandbox() {
  if (isTauriRuntime()) return "allow-scripts allow-downloads";
  return isHostedMcpWidget()
    ? undefined
    : "allow-scripts allow-downloads allow-same-origin";
}

export function ViewerFrame({
  document,
  iframeRef,
  stagingIframeRef,
  sourcePreview,
  onViewerLoad,
  onStagingLoad,
  className = "viewer-iframe",
  readOnly = false,
}: {
  document: ViewerDocument;
  iframeRef?: Ref<HTMLIFrameElement>;
  stagingIframeRef?: Ref<HTMLIFrameElement>;
  sourcePreview?: SourcePreviewFrameSnapshot;
  onViewerLoad?: (frame: HTMLIFrameElement, active: boolean) => void;
  onStagingLoad?: (identity: SourcePreviewIdentity, frame: HTMLIFrameElement) => void;
  className?: string;
  readOnly?: boolean;
}) {
  const tauriRuntime = isTauriRuntime();
  const heroEmbed = isWebDemoHeroEmbed();
  const preferences = useViewerPreferences();
  const deferred = useDeferredViewerRuntime(document, preferences);
  const sandbox = viewerFrameSandbox();
  const closeTransitionActive = document.renderer === "grid2d"
    && isGridDocumentCloseTransitionActive(document.id);
  const runtimePathForFrame = (runtimePath: string) => heroEmbed
    ? runtimePath.replace(
        "</head>",
        `<style id="burette-hero-interaction-lock">
          #buret-toolbar,
          #buret-scene-tree-toggle,
          #buret-scene-tree,
          .buret-preview-dock,
          .buret-docking-poses,
          .msp-viewport-top-left-controls,
          .msp-viewport-controls,
          .msp-selection-viewport-controls {
            pointer-events: none !important;
          }
        </style>
        <script>
          addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
          addEventListener("dblclick", (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
          addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
        </script>
        </head>`,
      )
    : runtimePath;

  const handleFrameLoad = (
    event: SyntheticEvent<HTMLIFrameElement>,
    active: boolean,
    identity?: SourcePreviewIdentity,
  ) => {
    // The runtime bakes the theme of the moment it was built, and live theme
    // changes only reach frames mounted at that time. A frame mounted later (the
    // dock remounts after Settings) has to be told the current theme.
    event.currentTarget.contentWindow?.postMessage({
      source: "burette-host",
      body: viewerAppearanceMessage(preferences),
    }, "*");
    onViewerLoad?.(event.currentTarget, active);
    if (document.renderer === "grid2d") {
      if (readOnly) {
        event.currentTarget.contentWindow?.postMessage({
          source: "burette-grid-host",
          body: { type: "gridReadOnlyChanged", readOnly: true },
        }, "*");
      }
      if (isGridDocumentCloseTransitionActive(document.id)) {
        event.currentTarget.contentWindow?.postMessage({
          source: "burette-grid-host",
          body: { type: "gridCloseTransitionChanged", active: true },
        }, "*");
        replayPendingGridCloseTransitionRequests(event.currentTarget);
      }
    }
    if (!active && identity) onStagingLoad?.(identity, event.currentTarget);
  };

  const renderSlot = (slot: SourcePreviewSlot, runtime: SourcePreviewRuntime) => {
    const active = sourcePreview?.activeSlot === slot;
    const identity = runtime.identity;
    const accessibleTitle = active ? document.title : `${document.title} preview candidate`;
    const commonProps = {
      ref: active ? iframeRef : stagingIframeRef,
      title: document.renderer === "grid2d" ? "" : accessibleTitle,
      "aria-label": document.renderer === "grid2d" ? accessibleTitle : undefined,
      className: active ? className : "source-preview-staging-iframe",
      ...(sandbox ? { sandbox } : {}),
      referrerPolicy: "no-referrer" as const,
      "aria-hidden": active ? undefined : true,
      inert: !active || closeTransitionActive,
      "aria-busy": closeTransitionActive || undefined,
      "data-document-id": document.id,
      "data-renderer": document.renderer,
      "data-read-only": readOnly ? "true" : undefined,
      name: readOnly ? "burette-read-only" : "burette-editable",
      "data-source-preview-role": active ? "active" : "staging",
      "data-source-preview-request-id": identity?.requestId,
      "data-source-preview-revision": identity?.revision,
      onLoad: (event: SyntheticEvent<HTMLIFrameElement>) => handleFrameLoad(event, active, identity),
      style: active ? undefined : {
        position: "absolute" as const,
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
        opacity: 0,
        pointerEvents: "none" as const,
      },
    };
    const runtimePath = runtimePathForFrame(runtime.runtimePath);
    return tauriRuntime ? (
      <iframe key={`${slot}:${runtime.runtimeKey}`} {...commonProps} src={convertFileSrc(runtime.runtimePath)} />
    ) : (
      <iframe key={`${slot}:${runtime.runtimeKey}`} {...commonProps} srcDoc={runtimePath} />
    );
  };

  if (document.runtimeDeferred) {
    return deferred.error
      ? <ViewerErrorState error={deferred.error} retry="always" onRetry={deferred.retry} bare variant="document" />
      : <FileViewerLoadingState title="Opening structure…" />;
  }

  if (!sourcePreview) {
    const commonProps = {
      ref: iframeRef,
      title: document.renderer === "grid2d" ? "" : document.title,
      "aria-label": document.renderer === "grid2d" ? document.title : undefined,
      className,
      ...(sandbox ? { sandbox } : {}),
      referrerPolicy: "no-referrer" as const,
      inert: closeTransitionActive,
      "aria-busy": closeTransitionActive || undefined,
      "data-document-id": document.id,
      "data-renderer": document.renderer,
      "data-read-only": readOnly ? "true" : undefined,
      name: readOnly ? "burette-read-only" : "burette-editable",
      onLoad: (event: SyntheticEvent<HTMLIFrameElement>) => handleFrameLoad(event, true),
    };
    const runtimePath = runtimePathForFrame(document.runtimePath);
    return tauriRuntime ? (
      <iframe key={document.runtimePath} {...commonProps} src={convertFileSrc(document.runtimePath)} />
    ) : (
      <iframe key={runtimePath} {...commonProps} srcDoc={runtimePath} />
    );
  }

  return (
    <>
      {sourcePreview.slots.primary ? renderSlot("primary", sourcePreview.slots.primary) : null}
      {sourcePreview.slots.secondary ? renderSlot("secondary", sourcePreview.slots.secondary) : null}
    </>
  );
}
