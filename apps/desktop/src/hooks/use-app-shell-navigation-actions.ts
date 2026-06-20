import { useCallback } from "react";
import type { AppSettingsSectionId } from "../components/types";

type UseAppShellNavigationActionsOptions = {
  activateLastNonSettingsTab: () => void;
  openSettingsSectionTab: (section: AppSettingsSectionId) => void;
  openSettingsTab: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
};

export function useAppShellNavigationActions({
  activateLastNonSettingsTab,
  openSettingsSectionTab,
  openSettingsTab,
  sidebarOpen,
  toggleSidebar,
}: UseAppShellNavigationActionsOptions) {
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
    openSettings,
    openSettingsSection,
  };
}
