import { useState } from "react";
import { ViewerControls } from "@/components/ui/viewer-controls";
import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";

// Production document controls with local callbacks; no remote requests or file writes.
export function DocumentControlsExamples() {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [selected, setSelected] = useState("");
  const downloads: ViewerDownloadAction[] = ["Original file", "PDF", "Plain text"].map(label => ({
    id: label, label, fileName: "report", origin: "derived", isDisabled: label === "PDF",
    getPayload: () => { setSelected(label); return { kind: "none" }; },
  }));
  return <section aria-label="Document controls" className="document-stage w-full max-w-[600px] shrink-0" style={{ position: "relative", inset: "auto" }}>
    <ViewerControls title="Report" position={{ kind: "page", current: 2, total: 5 }}
      zoom={{ scale, onZoomIn: () => setScale(s => Math.min(5, s * 1.2)), onZoomOut: () => setScale(s => Math.max(.1, s / 1.2)), onReset: () => setScale(1) }}
      rotate={{ onRotate: () => setRotation(value => (value + 90) % 360) }} downloads={downloads} />
    {(selected || rotation !== 0) && <output className="block pt-2 text-sm">{selected ? `Selected: ${selected}` : `Rotation: ${rotation}°`}</output>}
  </section>;
}
