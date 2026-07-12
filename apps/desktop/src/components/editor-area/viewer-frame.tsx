import { convertFileSrc } from "@tauri-apps/api/core";
import type { Ref } from "react";
import type { ViewerDocument } from "../../types";
import { isTauriRuntime } from "../../lib/tauri";
import { isHostedMcpWidget } from "../../lib/hosted-mcp-widget";
import { isWebDemoHeroEmbed } from "../../lib/web-demo-workspace";

export function viewerFrameSandbox() {
  if (isTauriRuntime()) return "allow-scripts allow-downloads";
  return isHostedMcpWidget()
    ? undefined
    : "allow-scripts allow-downloads allow-same-origin";
}

export function ViewerFrame({
  document,
  iframeRef,
  className = "viewer-iframe",
}: {
  document: ViewerDocument;
  iframeRef?: Ref<HTMLIFrameElement>;
  className?: string;
}) {
  const tauriRuntime = isTauriRuntime();
  const heroEmbed = isWebDemoHeroEmbed();
  const sandbox = viewerFrameSandbox();
  const runtimePath = heroEmbed
    ? document.runtimePath.replace(
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
    : document.runtimePath;
  const commonProps = {
    ref: iframeRef,
    title: document.title,
    className,
    ...(sandbox ? { sandbox } : {}),
    referrerPolicy: "no-referrer" as const,
    "data-document-id": document.id,
    "data-renderer": document.renderer,
  };
  return tauriRuntime ? (
    <iframe key={document.runtimePath} {...commonProps} src={convertFileSrc(document.runtimePath)} />
  ) : (
    <iframe key={runtimePath} {...commonProps} srcDoc={runtimePath} />
  );
}
