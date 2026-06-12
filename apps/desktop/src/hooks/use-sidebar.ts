import { useShellStore } from "../stores/shell-store";

export function useSidebar() {
  const sidebarOpen = useShellStore((state) => state.sidebarOpen);
  const sidebarWidth = useShellStore((state) => state.sidebarWidth);
  const projectsOpen = useShellStore((state) => state.projectsOpen);
  const projectRoots = useShellStore((state) => state.projectRoots);
  const pinnedProjectRoots = useShellStore((state) => state.pinnedProjectRoots);
  const projectNameOverrides = useShellStore((state) => state.projectNameOverrides);
  const expandedProjectIds = useShellStore((state) => state.expandedProjectIds);
  const hiddenProjectRoots = useShellStore((state) => state.hiddenProjectRoots);
  const pinnedStructurePaths = useShellStore((state) => state.pinnedStructurePaths);
  const sidebarQuery = useShellStore((state) => state.sidebarQuery);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const closeSidebar = useShellStore((state) => state.closeSidebar);
  const setSidebarWidth = useShellStore((state) => state.setSidebarWidth);
  const toggleProjectsOpen = useShellStore((state) => state.toggleProjectsOpen);
  const setExpandedProjectIds = useShellStore((state) => state.setExpandedProjectIds);
  const addProjectRoot = useShellStore((state) => state.addProjectRoot);
  const togglePinnedProjectRoot = useShellStore((state) => state.togglePinnedProjectRoot);
  const renameProjectRoot = useShellStore((state) => state.renameProjectRoot);
  const removeProjectRoot = useShellStore((state) => state.removeProjectRoot);
  const togglePinnedStructure = useShellStore((state) => state.togglePinnedStructure);
  const pruneSidebarPaths = useShellStore((state) => state.pruneSidebarPaths);
  const setSidebarQuery = useShellStore((state) => state.setSidebarQuery);
  const toggleProjectExpanded = useShellStore((state) => state.toggleProjectExpanded);

  return {
    isSidebarCollapsed: !sidebarOpen,
    isSidebarVisible: sidebarOpen,
    sidebarOpen,
    sidebarWidth,
    projectsOpen,
    projectRoots,
    pinnedProjectRoots,
    projectNameOverrides,
    expandedProjectIds,
    hiddenProjectRoots,
    pinnedStructurePaths,
    sidebarQuery,
    setSidebarWidth,
    toggleProjectsOpen,
    setExpandedProjectIds,
    addProjectRoot,
    togglePinnedProjectRoot,
    renameProjectRoot,
    removeProjectRoot,
    togglePinnedStructure,
    pruneSidebarPaths,
    setSidebarQuery,
    toggleProjectExpanded,
    toggleSidebar,
    closeSidebar,
  };
}
