import { useCallback } from "react";
import { useOpenCommandPalette } from "./use-command-palette";
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

  const focusSidebarSearch = useOpenCommandPalette();

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
