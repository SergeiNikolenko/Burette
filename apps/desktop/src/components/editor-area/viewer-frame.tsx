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
import {
  isGridDocumentCloseTransitionActive,
  replayPendingGridCloseTransitionRequests,
} from "../../lib/window-mutation-barrier";

// Every mounted viewer iframe, frozen at the pixel size it had when the shell
// started a layout gesture. `.viewer-iframe` is sized 100% x 100%, so a panel
// drag re-laid the iframe out on every frame and Mol* inside redrew each time;
// pinning the frame for the duration of the gesture (measured earlier: ~30 to
// ~50 fps on a dock drag) leaves one reflow for the release. The pin is
// reference counted because a drag can overlap a toggle animation, and the
// shell carries `data-resizing` while any pin is held so the CSS can drop
// pointer events on the frames (an iframe under the pointer would otherwise
// swallow the drag).
let framePinDepth = 0;
let pinnedFrames: HTMLIFrameElement[] = [];
let pinnedRoot: HTMLElement | null = null;

export function pinViewerFrames(root: HTMLElement): () => void {
  if (framePinDepth++ === 0) {
    pinnedRoot = root;
    pinnedFrames = Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe.viewer-iframe"));
    for (const frame of pinnedFrames) {
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
    }
    root.setAttribute("data-resizing", "true");
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--framePinDepth > 0) return;
    for (const frame of pinnedFrames) {
      frame.style.removeProperty("width");
      frame.style.removeProperty("height");
    }
    pinnedFrames = [];
    pinnedRoot?.removeAttribute("data-resizing");
    pinnedRoot = null;
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
      onLoad: document.renderer === "grid2d" || onViewerLoad || (!active && identity)
        ? (event: SyntheticEvent<HTMLIFrameElement>) => handleFrameLoad(event, active, identity)
        : undefined,
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
      onLoad: document.renderer === "grid2d" || onViewerLoad
        ? (event: SyntheticEvent<HTMLIFrameElement>) => handleFrameLoad(event, true)
        : undefined,
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
