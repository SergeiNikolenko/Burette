import { Suspense, lazy } from "react";
import { DEFAULT_SETTINGS_SECTION, normalizeSettingsSection, settingsSectionLabel, type SettingsSectionId } from "../../../lib/settings-sections";
import { definePageKind } from "./types";

export type SettingsLocation = { kind: "settings"; section: SettingsSectionId };

const SettingsPanel = lazy(() => import("../../settings-panel").then((module) => ({
  default: module.SettingsPanel,
})));

export const settingsKind = definePageKind<"settings", SettingsLocation>({
  kind: "settings",
  title: (location) => settingsSectionLabel(location.section),
  description: "App preferences",
  Component: ({ location, state, actions }) => (
    <Suspense fallback={null}>
      <SettingsPanel location={location} state={state} actions={actions} />
    </Suspense>
  ),
  fromPayload: (data) => ({ kind: "settings", section: normalizeSettingsSection(data.section) }),
  serialize: (location) => ({ section: location.section ?? DEFAULT_SETTINGS_SECTION }),
  keepAlive: true,
});
