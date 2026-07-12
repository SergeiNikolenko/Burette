import { convertFileSrc } from "@tauri-apps/api/core";
import type { Ref } from "react";
import type { ViewerDocument } from "../../types";
import { isTauriRuntime } from "../../lib/tauri";
import { isHostedMcpWidget } from "../../lib/hosted-mcp-widget";

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
  const sandbox = viewerFrameSandbox();
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
    <iframe key={document.runtimePath} {...commonProps} srcDoc={document.runtimePath} />
  );
}
