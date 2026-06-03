import { Suspense, lazy } from "react";
import { definePageKind } from "./types";

export type SettingsLocation = { kind: "settings" };

const SettingsPanel = lazy(() => import("../../settings-panel").then((module) => ({
  default: module.SettingsPanel,
})));

export const settingsKind = definePageKind<"settings", SettingsLocation>({
  kind: "settings",
  title: () => "Settings",
  description: "App preferences",
  Component: ({ state, actions }) => (
    <Suspense fallback={null}>
      <SettingsPanel state={state} actions={actions} />
    </Suspense>
  ),
  keepAlive: true,
});
