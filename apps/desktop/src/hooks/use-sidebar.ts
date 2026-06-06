import { useShellStore } from "../stores/shell-store";

export function useSidebar() {
  const sidebarOpen = useShellStore((state) => state.sidebarOpen);
  const sidebarWidth = useShellStore((state) => state.sidebarWidth);
  const projectsOpen = useShellStore((state) => state.projectsOpen);
  const projectRoots = useShellStore((state) => state.projectRoots);
  const expandedProjectIds = useShellStore((state) => state.expandedProjectIds);
  const pinnedStructurePaths = useShellStore((state) => state.pinnedStructurePaths);
  const sidebarQuery = useShellStore((state) => state.sidebarQuery);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const closeSidebar = useShellStore((state) => state.closeSidebar);
  const setSidebarWidth = useShellStore((state) => state.setSidebarWidth);
  const toggleProjectsOpen = useShellStore((state) => state.toggleProjectsOpen);
  const setExpandedProjectIds = useShellStore((state) => state.setExpandedProjectIds);
  const addProjectRoot = useShellStore((state) => state.addProjectRoot);
  const togglePinnedStructure = useShellStore((state) => state.togglePinnedStructure);
  const setSidebarQuery = useShellStore((state) => state.setSidebarQuery);
  const toggleProjectExpanded = useShellStore((state) => state.toggleProjectExpanded);

  return {
    isSidebarCollapsed: !sidebarOpen,
    isSidebarVisible: sidebarOpen,
    sidebarOpen,
    sidebarWidth,
    projectsOpen,
    projectRoots,
    expandedProjectIds,
    pinnedStructurePaths,
    sidebarQuery,
    setSidebarWidth,
    toggleProjectsOpen,
    setExpandedProjectIds,
    addProjectRoot,
    togglePinnedStructure,
    setSidebarQuery,
    toggleProjectExpanded,
    toggleSidebar,
    closeSidebar,
  };
}
