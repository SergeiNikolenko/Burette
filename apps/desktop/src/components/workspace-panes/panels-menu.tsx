import { SidebarRight } from "../ui/app-icons";
import { ToolbarButton } from "../ui/toolbar-button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from "../ui/dropdown-menu";
import { ShortcutTooltip } from "../shortcut-tooltip";

export function PanelsMenu({ sideOpen, rightOpen, bottomOpen, bottomAvailable, toggleSide, toggleRight, toggleBottom }: {
  sideOpen: boolean; rightOpen: boolean; bottomOpen: boolean; bottomAvailable: boolean;
  toggleSide: () => void; toggleRight: () => void; toggleBottom: () => void;
}) {
  return <DropdownMenu>
    <ShortcutTooltip label="Panels">
      <DropdownMenuTrigger asChild>
        <ToolbarButton className="dock-toggle-button" aria-label="Panels" selected={sideOpen || rightOpen || bottomOpen}>
          <SidebarRight size={16} aria-hidden />
        </ToolbarButton>
      </DropdownMenuTrigger>
    </ShortcutTooltip>
    <DropdownMenuContent align="end">
      <DropdownMenuCheckboxItem checked={sideOpen} onCheckedChange={toggleSide}>Side panel</DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={rightOpen} onCheckedChange={toggleRight}>Right dock</DropdownMenuCheckboxItem>
      {bottomAvailable && <DropdownMenuCheckboxItem checked={bottomOpen} onCheckedChange={toggleBottom}>Bottom dock</DropdownMenuCheckboxItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
