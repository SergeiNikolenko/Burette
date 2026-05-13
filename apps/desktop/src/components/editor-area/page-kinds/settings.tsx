import type { ShellTab } from "../../types";
import { SettingsPage } from "../../settings-panel";
import { definePageKind } from "./types";

type SettingsTab = ShellTab & { kind: "settings" };

function SettingsPageKind({
  isActive,
  state,
  actions,
}: {
  tab: SettingsTab;
  isActive: boolean;
  state: Parameters<typeof SettingsPage>[0]["state"];
  actions: Parameters<typeof SettingsPage>[0]["actions"];
}) {
  return (
    <div className="editor-page" hidden={!isActive} aria-hidden={!isActive}>
      <SettingsPage state={state} actions={actions} />
    </div>
  );
}

export const settingsKind = definePageKind<SettingsTab>({
  kind: "settings",
  title: () => "Settings",
  description: "Application settings",
  Component: SettingsPageKind,
  keepAlive: true,
});
