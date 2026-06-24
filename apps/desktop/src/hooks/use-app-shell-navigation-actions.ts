import { useCallback } from "react";
import type { AppSettingsSectionId } from "../components/types";

type UseAppShellNavigationActionsOptions = {
  activateLastNonSettingsTab: () => void;
  openSettingsSectionTab: (section: AppSettingsSectionId) => void;
  openSettingsTab: () => void;
  setActiveDocument: (id: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
};

export function useAppShellNavigationActions({
  activateLastNonSettingsTab,
  openSettingsSectionTab,
  openSettingsTab,
  setActiveDocument,
  sidebarOpen,
  toggleSidebar,
}: UseAppShellNavigationActionsOptions) {
  const selectDocument = useCallback((id: string) => {
    setActiveDocument(id);
  }, [setActiveDocument]);

  const focusSidebarSearch = useCallback(() => {
    if (!sidebarOpen) toggleSidebar();
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>("[data-sidebar-search]")?.focus();
    }, 0);
  }, [sidebarOpen, toggleSidebar]);

  const openSettings = useCallback(() => {
    if (!sidebarOpen) toggleSidebar();
    openSettingsTab();
  }, [openSettingsTab, sidebarOpen, toggleSidebar]);

  const openSettingsSection = useCallback((section: AppSettingsSectionId) => {
    if (!sidebarOpen) toggleSidebar();
    openSettingsSectionTab(section);
  }, [openSettingsSectionTab, sidebarOpen, toggleSidebar]);

  const backToApp = useCallback(() => {
    activateLastNonSettingsTab();
  }, [activateLastNonSettingsTab]);

  return {
    backToApp,
    focusSidebarSearch,
    openSettings,
    openSettingsSection,
    selectDocument,
  };
}
