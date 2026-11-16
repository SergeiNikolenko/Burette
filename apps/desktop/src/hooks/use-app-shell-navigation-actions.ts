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
}: UseAppShellNavigationActionsOptions) {
  const selectDocument = useCallback((id: string) => {
    setActiveDocument(id);
  }, [setActiveDocument]);

  const focusSidebarSearch = useOpenCommandPalette();

  const openSettings = useCallback(() => {
    openSettingsTab();
  }, [openSettingsTab]);

  const openSettingsSection = useCallback((section: AppSettingsSectionId) => {
    openSettingsSectionTab(section);
  }, [openSettingsSectionTab]);

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
