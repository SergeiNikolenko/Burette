import type { MouseEvent } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { showNativeContextMenu } from "../native-context-menu";
import { menuSections } from "../workspace-menu-items";
import { ShortcutTooltip } from "../shortcut-tooltip";
import { ToolbarButton } from "../ui/toolbar-button";
import { DotsHorizontal, SidebarRight } from "../ui/app-icons";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";
import { PaneSwitcher } from "./pane-switcher";
import { paneMoveItems } from "./pane-actions";
import { useSidePaneTabs } from "./use-pane-tabs";
import "./workspace-panes.css";

// The side panel column: a header with the screen switcher and pane actions.
// The screen itself is not rendered here; its page surface stays in the main
// page stack and is laid over the body (see workspace-panes.css).
export function SidePane({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const { visibleTab } = useSidePaneTabs();
  const setSideHidden = useWorkspacePanesStore((store) => store.setSideHidden);
  if (!visibleTab) return null;
  const openMore = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(menuSections(
      paneMoveItems(visibleTab, state, actions),
      [{ kind: "item", id: "side-pane-close-screen", text: "Close", action: () => { void actions.closeTab(visibleTab.id); } }],
    ), { x: rect.left, y: rect.bottom + 4 }, { presentation: "dropdown" });
  };
  return (
    <div className="side-pane" data-page-kind={visibleTab.location.kind}>
      <div className="side-pane-header">
        <PaneSwitcher pane="side" tab={visibleTab} state={state} actions={actions} />
        <span className="side-pane-header-spacer" />
        <ShortcutTooltip label="More">
          <ToolbarButton aria-label="More" onMouseDown={(event) => event.preventDefault()} onClick={openMore}>
            <DotsHorizontal size={16} aria-hidden />
          </ToolbarButton>
        </ShortcutTooltip>
        <ShortcutTooltip label="Hide side panel">
          <ToolbarButton aria-label="Hide side panel" onMouseDown={(event) => event.preventDefault()} onClick={() => setSideHidden(true)}>
            <SidebarRight size={16} aria-hidden />
          </ToolbarButton>
        </ShortcutTooltip>
      </div>
      <div className="side-pane-body" />
    </div>
  );
}
