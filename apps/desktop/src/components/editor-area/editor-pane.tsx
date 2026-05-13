import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { ViewerDocument } from "../../types";
import { useEditorStore } from "../../stores/editor-store";

type EditorPaneProps = {
  document: ViewerDocument;
  isActive: boolean;
};

export function EditorPane({ document, isActive }: EditorPaneProps) {
  const url = convertFileSrc(document.runtimePath);
  const setDocumentLoadState = useEditorStore((state) => state.setDocumentLoadState);
  const clearDocumentLoadState = useEditorStore((state) => state.clearDocumentLoadState);

  useEffect(() => {
    setDocumentLoadState(document.id, "loading");
    return () => clearDocumentLoadState(document.id);
  }, [clearDocumentLoadState, document.id, document.runtimePath, setDocumentLoadState]);

  return (
    <div className="viewer-pane editor-page" hidden={!isActive} aria-hidden={!isActive}>
      <iframe
        title={document.title}
        src={url}
        className="viewer-iframe"
        sandbox="allow-scripts allow-downloads"
        referrerPolicy="no-referrer"
        onLoad={() => setDocumentLoadState(document.id, "ready")}
        onError={() => setDocumentLoadState(document.id, "error")}
      />
    </div>
  );
}
