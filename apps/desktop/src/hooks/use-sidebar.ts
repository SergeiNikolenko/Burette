import { useAppStore } from "../store";

export function toggleSidebar() {
  useAppStore.getState().toggleSidebar();
}

export function useSidebar() {
  const isSidebarVisible = useAppStore((state) => state.sidebarOpen);
  const sidebarWidth = useAppStore((state) => state.sidebarWidth);
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth);

  return {
    isSidebarCollapsed: !isSidebarVisible,
    isSidebarVisible,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebar,
  };
}
