import { useEffect, useRef } from "react";
import { SpectrumViewer } from "./spectrum-viewer";
import { ViewerFrame } from "./editor-area/viewer-frame";
import type { ViewerDocument } from "../types";

export function QuickLookPreview({
  document,
  onClose,
  standalone = false,
}: {
  document: ViewerDocument;
  onClose: () => void;
  standalone?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      ref={dialogRef}
      className={standalone ? "web-quicklook-backdrop web-quicklook-backdrop-standalone" : "web-quicklook-backdrop"}
      role="dialog"
      aria-modal="true"
      aria-label={`Quick Look ${document.title}`}
      tabIndex={-1}
    >
      <section className="web-quicklook-window">
        <header className="web-quicklook-titlebar">
          <div className="web-quicklook-traffic-lights">
            <button type="button" className="web-quicklook-light web-quicklook-close-dot" onClick={onClose} aria-label="Close Quick Look" />
            <span className="web-quicklook-light web-quicklook-minimize-dot" aria-hidden="true" />
            <span className="web-quicklook-light web-quicklook-zoom-dot" aria-hidden="true" />
          </div>
          <div className="web-quicklook-title">
            <span>{document.title}</span>
            <small>{document.extension.toUpperCase()} / {document.renderer}</small>
          </div>
          <button type="button" className="web-quicklook-done" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="web-quicklook-content">
          {document.renderer === "spectrum" ? (
            <SpectrumViewer document={document} />
          ) : (
            <ViewerFrame document={document} className="web-quicklook-iframe" />
          )}
        </div>
      </section>
    </div>
  );
}
