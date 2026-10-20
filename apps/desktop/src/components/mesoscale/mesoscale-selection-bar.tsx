import { Cube as Box, Delete as Trash2, X } from "@/components/ui/app-icons";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { ShortcutTooltip } from "../shortcut-tooltip";
import { requestMesoscale, useMesoscaleStore } from "../../stores/mesoscale-store";

export function MesoscaleSelectionBar({ documentId }: { documentId: string }) {
  const summary = useMesoscaleStore((state) => state.sessions[documentId]?.summary);
  if (!summary?.selectionMode) return null;
  const count = summary.selectedCount ?? summary.selectedRefs.length;
  const run = (action: Parameters<typeof requestMesoscale>[1]) => void requestMesoscale(documentId, action).catch(() => undefined);
  const commands = [
    { label: "Clear selection", Icon: Trash2, disabled: count === 0, onClick: () => run({ type: "setSelection", mode: "clear" }) },
    { label: "Exit selection mode", Icon: X, disabled: false, onClick: () => run({ type: "setSelectionMode", enabled: false }) },
  ];
  return (
      <div className="mesoscale-selection-bar" role="toolbar" aria-label="Burette selection controls">
        <span className="mesoscale-selection-level" aria-label="Selection level: Structure"><Box size={14} aria-hidden="true" /><span>Structure</span></span>
        <span className="mesoscale-selection-count" aria-live="polite">{count ? `${count.toLocaleString()} selected` : "Nothing selected"}</span>
        {commands.map(({ label, Icon, disabled, onClick }) => (
          <ShortcutTooltip key={label} label={label}>
            <ToolbarButton disabled={disabled} aria-label={label} onClick={onClick}><Icon aria-hidden /></ToolbarButton>
          </ShortcutTooltip>
        ))}
      </div>
  );
}
