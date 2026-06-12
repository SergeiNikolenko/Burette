import { convertFileSrc } from "@tauri-apps/api/core";
import type { Ref } from "react";
import type { ViewerDocument } from "../../types";
import { isTauriRuntime } from "../../lib/tauri";

export function viewerFrameSandbox() {
  return isTauriRuntime()
    ? "allow-scripts allow-downloads"
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
    sandbox,
    referrerPolicy: "no-referrer" as const,
    "data-document-id": document.id,
  };
  return tauriRuntime ? (
    <iframe {...commonProps} src={convertFileSrc(document.runtimePath)} />
  ) : (
    <iframe {...commonProps} srcDoc={document.runtimePath} />
  );
}
