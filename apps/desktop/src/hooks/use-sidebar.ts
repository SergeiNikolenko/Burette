import { useShellStore } from "../stores/shell-store";

export function useSidebar() {
  const sidebarOpen = useShellStore((state) => state.sidebarOpen);
  const sidebarWidth = useShellStore((state) => state.sidebarWidth);
  const projectRoots = useShellStore((state) => state.projectRoots);
  const expandedProjectIds = useShellStore((state) => state.expandedProjectIds);
  const sidebarQuery = useShellStore((state) => state.sidebarQuery);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const setSidebarWidth = useShellStore((state) => state.setSidebarWidth);
  const addProjectRoot = useShellStore((state) => state.addProjectRoot);
  const setSidebarQuery = useShellStore((state) => state.setSidebarQuery);
  const toggleProjectExpanded = useShellStore((state) => state.toggleProjectExpanded);

  return {
    isSidebarCollapsed: !sidebarOpen,
    isSidebarVisible: sidebarOpen,
    sidebarOpen,
    sidebarWidth,
    projectRoots,
    expandedProjectIds,
    sidebarQuery,
    setSidebarWidth,
    addProjectRoot,
    setSidebarQuery,
    toggleProjectExpanded,
    toggleSidebar,
  };
}
