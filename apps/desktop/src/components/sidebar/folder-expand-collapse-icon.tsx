import { Collapse, Expand } from "../ui/app-icons";

export function FolderExpandCollapseIcon({ collapse }: { collapse: boolean }) {
  const Icon = collapse ? Collapse : Expand;
  return <Icon size={16} aria-hidden />;
}
