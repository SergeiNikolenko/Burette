import { SidebarRight } from "../ui/app-icons";
import { ToolbarButton } from "../ui/toolbar-button";
import { ShortcutTooltip } from "../shortcut-tooltip";

// The title bar's trailing panel button shows or hides the right dock. The
// bottom dock has no button of its own and opens from its shortcut (⌘J).
export function RightDockToggle({ open, toggle }: { open: boolean; toggle: () => void }) {
  return <ShortcutTooltip label={open ? "Hide right panel" : "Show right panel"} shortcut="⌥⌘B">
    <ToolbarButton className="dock-toggle-button" aria-label="Toggle right panel" aria-pressed={open} selected={open}
      onMouseDown={(event) => event.preventDefault()} onClick={toggle}>
      <SidebarRight size={16} aria-hidden />
    </ToolbarButton>
  </ShortcutTooltip>;
}
