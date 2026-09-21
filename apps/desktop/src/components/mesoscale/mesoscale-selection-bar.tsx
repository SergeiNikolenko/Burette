import { Box, Trash2, X } from "lucide-react";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";

export function MesoscaleSelectionBar({ documentId }: { documentId: string }) {
  const summary = useMesoscaleStore((state) => state.sessions[documentId]?.summary);
  if (!summary?.selectionMode) return null;
  const count = summary.selectedCount ?? summary.selectedRefs.length;
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(documentId, action).catch(() => undefined);
  return (
    <div className="mesoscale-selection-bar" role="toolbar" aria-label="Burette selection controls">
      <span className="mesoscale-selection-level" aria-label="Selection level: Structure"><Box size={14} aria-hidden="true" /><span>Structure</span></span>
      <span className="mesoscale-selection-count" aria-live="polite">{count ? `${count.toLocaleString()} selected` : "Nothing selected"}</span>
      <button type="button" disabled={count === 0} onClick={() => run({ type: "setSelection", mode: "clear" })} aria-label="Clear selection" title="Clear selection"><Trash2 size={14} /></button>
      <button type="button" onClick={() => run({ type: "setSelectionMode", enabled: false })} aria-label="Exit selection mode" title="Exit selection mode"><X size={15} /></button>
    </div>
  );
}
