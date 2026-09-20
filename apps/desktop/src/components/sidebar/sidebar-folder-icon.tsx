import { SidebarFolder, SidebarFolderOpen, SidebarGlobe } from "../ui/app-icons";

// Globe badges are available for sources that supply a network identity.
// Local filesystem folders deliberately carry no network badge.
export function SidebarFolderIcon({ expanded, badge }: {
  expanded: boolean;
  badge?: "cyan" | "blue" | "purple";
}) {
  const Icon = expanded ? SidebarFolderOpen : SidebarFolder;
  return (
    <span className="project-folder-icon" aria-hidden="true">
      <Icon size={16} strokeWidth={1.7} />
      {badge && <SidebarGlobe className={`project-folder-badge project-folder-badge-${badge}`} size={8} strokeWidth={2} />}
    </span>
  );
}
