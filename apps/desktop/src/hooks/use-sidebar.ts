import { useShellStore } from "../stores/shell-store";

export function useSidebar() {
  const sidebarOpen = useShellStore((state) => state.sidebarOpen);
  const sidebarWidth = useShellStore((state) => state.sidebarWidth);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const setSidebarWidth = useShellStore((state) => state.setSidebarWidth);

  return {
    isSidebarCollapsed: !sidebarOpen,
    isSidebarVisible: sidebarOpen,
    sidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
  };
}
