import { Suspense, lazy } from "react";
import { DEFAULT_SETTINGS_SECTION, normalizeSettingsSection, settingsSectionLabel, type AppSettingsSectionId } from "../../../lib/settings-sections";
import { definePageKind } from "./types";

export type SettingsLocation = { kind: "settings"; section: AppSettingsSectionId };

const SettingsPanel = lazy(() => import("../../settings-panel").then((module) => ({
  default: module.SettingsPanel,
})));

export const settingsKind = definePageKind<"settings", SettingsLocation>({
  kind: "settings",
  title: (location) => settingsSectionLabel(location.section),
  description: "App preferences",
  Component: ({ location, state, actions }) => (
    <Suspense fallback={null}>
      <SettingsPanel location={location} state={state} actions={actions} extensions={{
        ...state.resourceExtensions, jobs: state.resourceJobs,
        installCrystals: actions.installCrystals, remove: actions.removeCrystals, refresh: actions.refreshResourceExtensions,
        openCrystalsStructure: actions.openCrystalsStructure,
        cancel: actions.cancelResourceJob, clearFinished: actions.clearResourceJobs,
      }} />
    </Suspense>
  ),
  fromPayload: (data) => ({ kind: "settings", section: normalizeSettingsSection(data.section) }),
  serialize: (location) => ({ section: location.section ?? DEFAULT_SETTINGS_SECTION }),
  keepAlive: true,
});
