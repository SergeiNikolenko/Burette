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
  onStagingLoad,
  className = "viewer-iframe",
  readOnly = false,
}: {
  document: ViewerDocument;
  iframeRef?: Ref<HTMLIFrameElement>;
  stagingIframeRef?: Ref<HTMLIFrameElement>;
  sourcePreview?: SourcePreviewFrameSnapshot;
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
        `<style id="burrete-hero-interaction-lock">
          #buret-toolbar,
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
    if (document.renderer === "grid2d") {
      if (readOnly) {
        event.currentTarget.contentWindow?.postMessage({
          source: "burrete-grid-host",
          body: { type: "gridReadOnlyChanged", readOnly: true },
        }, "*");
      }
      if (isGridDocumentCloseTransitionActive(document.id)) {
        event.currentTarget.contentWindow?.postMessage({
          source: "burrete-grid-host",
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
    const commonProps = {
      ref: active ? iframeRef : stagingIframeRef,
      title: active ? document.title : `${document.title} preview candidate`,
      className: active ? className : "source-preview-staging-iframe",
      ...(sandbox ? { sandbox } : {}),
      referrerPolicy: "no-referrer" as const,
      "aria-hidden": active ? undefined : true,
      inert: !active || closeTransitionActive,
      "aria-busy": closeTransitionActive || undefined,
      "data-document-id": document.id,
      "data-renderer": document.renderer,
      "data-read-only": readOnly ? "true" : undefined,
      name: readOnly ? "burrete-read-only" : "burrete-editable",
      "data-source-preview-role": active ? "active" : "staging",
      "data-source-preview-request-id": identity?.requestId,
      "data-source-preview-revision": identity?.revision,
      onLoad: document.renderer === "grid2d" || (!active && identity)
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
      title: document.title,
      className,
      ...(sandbox ? { sandbox } : {}),
      referrerPolicy: "no-referrer" as const,
      inert: closeTransitionActive,
      "aria-busy": closeTransitionActive || undefined,
      "data-document-id": document.id,
      "data-renderer": document.renderer,
      "data-read-only": readOnly ? "true" : undefined,
      name: readOnly ? "burrete-read-only" : "burrete-editable",
      onLoad: document.renderer === "grid2d"
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
