import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";
import { ShortcutTooltip } from "../shortcut-tooltip";
import { Collapse } from "../ui/app-icons";
import { ToolbarButton } from "../ui/toolbar-button";

export function FullViewExitButton() {
  const fullView = useWorkspacePanesStore(state => state.fullViewTabId !== null);
  if (!fullView) return null;
  return (
    <ShortcutTooltip label="Exit Full View">
      <ToolbarButton type="button" aria-label="Exit Full View"
        onClick={() => useWorkspacePanesStore.getState().setFullView(null)}>
        <Collapse size={16} aria-hidden />
      </ToolbarButton>
    </ShortcutTooltip>
  );
}
