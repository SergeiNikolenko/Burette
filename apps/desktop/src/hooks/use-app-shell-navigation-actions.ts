import { useCallback } from "react";
import type { AppSettingsSectionId } from "../components/types";
import type { CommandPaletteIntent } from "./use-command-palette";

type UseAppShellNavigationActionsOptions = {
  activateLastNonSettingsTab: () => void;
  openCommandPalette: (intent?: CommandPaletteIntent) => void;
  openSettingsSectionTab: (section: AppSettingsSectionId) => void;
  openSettingsTab: () => void;
  setActiveDocument: (id: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
};

export function useAppShellNavigationActions({
  activateLastNonSettingsTab,
  openCommandPalette,
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
    openCommandPalette("search");
  }, [openCommandPalette]);

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
