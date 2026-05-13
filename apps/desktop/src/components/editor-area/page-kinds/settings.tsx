import { SettingsPanel } from "../../settings-panel";
import { definePageKind } from "./types";

export type SettingsLocation = { kind: "settings" };

export const settingsKind = definePageKind<"settings", SettingsLocation>({
  kind: "settings",
  title: () => "Settings",
  description: "App preferences",
  Component: ({ state, actions }) => <SettingsPanel state={state} actions={actions} />,
  keepAlive: true,
});
