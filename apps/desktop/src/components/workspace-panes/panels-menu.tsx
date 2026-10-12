import { SidebarRight } from "../ui/app-icons";
import { ToolbarButton } from "../ui/toolbar-button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from "../ui/dropdown-menu";
import { ShortcutTooltip } from "../shortcut-tooltip";

export function PanelsMenu({ rightOpen, bottomOpen, bottomAvailable, toggleRight, toggleBottom }: {
  rightOpen: boolean; bottomOpen: boolean; bottomAvailable: boolean;
  toggleRight: () => void; toggleBottom: () => void;
}) {
  return <DropdownMenu>
    <ShortcutTooltip label="Panels">
      <DropdownMenuTrigger asChild>
        <ToolbarButton className="dock-toggle-button" aria-label="Panels" selected={rightOpen || bottomOpen}>
          <SidebarRight size={16} aria-hidden />
        </ToolbarButton>
      </DropdownMenuTrigger>
    </ShortcutTooltip>
    <DropdownMenuContent align="end">
      <DropdownMenuCheckboxItem checked={rightOpen} onCheckedChange={toggleRight}>Side panel</DropdownMenuCheckboxItem>
      {bottomAvailable && <DropdownMenuCheckboxItem checked={bottomOpen} onCheckedChange={toggleBottom}>Bottom dock</DropdownMenuCheckboxItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
