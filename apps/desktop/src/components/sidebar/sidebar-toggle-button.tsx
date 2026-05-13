import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function SidebarToggleButton({
  isSidebarOpen,
  onToggleSidebar,
}: {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <button
      type="button"
      className="chrome-button sidebar-toggle-root"
      onClick={onToggleSidebar}
      title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
      aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
    >
      <HugeiconsIcon icon={SidebarLeftIcon} size={18} color="currentColor" strokeWidth={2} />
    </button>
  );
}
