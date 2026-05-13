import type { ViewerPreferences } from "../../types";
import type { UpdateChannel } from "../../update";
import { CURRENT_VERSION, defaultUpdatePreferences } from "../../update";
import { defaultPreferences } from "../../stores/settings-store";
import { EditorScrollContainer } from "../editor-area/editor-scroll-container";
import type { ShellActions, ShellViewState } from "../types";
import { SettingsSection, ToggleControl, actionRow, selectPreferenceRow, type SettingRow } from "./setting-control";

function preferenceRow<K extends keyof ViewerPreferences & string>(
  label: string,
  description: string,
  value: ViewerPreferences[K],
  options: ViewerPreferences[K][],
  defaultValue: ViewerPreferences[K],
  onChange: (value: ViewerPreferences[K]) => void,
): SettingRow {
  return selectPreferenceRow(
    label,
    description,
    String(value),
    options.map(String),
    String(defaultValue),
    (next) => onChange(next as ViewerPreferences[K]),
  );
}

export function SettingsPanel({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const preferences = state.preferences;
  const update = state.update;
  const updateRows: SettingRow[] = [
    {
      label: "Automatic checks",
      description: "Check GitHub releases in the background.",
      control: (
        <ToggleControl
          label="Automatic checks"
          checked={update.preferences.checkAutomatically}
          onChange={(checked) => actions.setUpdatePreferences({ ...update.preferences, checkAutomatically: checked })}
        />
      ),
      reset: () => actions.setUpdatePreferences({ ...update.preferences, checkAutomatically: defaultUpdatePreferences.checkAutomatically }),
      isModified: update.preferences.checkAutomatically !== defaultUpdatePreferences.checkAutomatically,
    },
    selectPreferenceRow(
      "Channel",
      "Stable ignores prereleases; beta includes prereleases.",
      update.preferences.channel,
      ["stable", "beta"],
      defaultUpdatePreferences.channel,
      (channel) => actions.setUpdatePreferences({ ...update.preferences, channel: channel as UpdateChannel }),
    ),
    actionRow("Version", update.statusText, update.isChecking ? "Checking..." : "Check", () => void actions.checkForUpdates(), update.isChecking),
  ];

  if (update.availableRelease) {
    updateRows.push(actionRow(
      "Available release",
      update.availableRelease.installAsset ? update.availableRelease.installAsset.name : "Current " + CURRENT_VERSION + ", latest " + update.availableRelease.tagName,
      update.availableRelease.installAsset ? (update.isInstalling ? "Installing..." : "Install and Restart") : "Open Release Page",
      update.availableRelease.installAsset ? () => void actions.installUpdate() : () => void actions.openUpdateRelease(),
      update.isInstalling,
    ));
  }

  return (
    <div className="settings-panel" data-settings-panel>
      <EditorScrollContainer>
        <div className="settings-panel-content">
          <h1>Preferences</h1>
          <SettingsSection
            title="Display"
            rows={[
              preferenceRow<"theme">("Theme", "Match the system, force dark mode, or force light mode.", preferences.theme, ["auto", "dark", "light"], defaultPreferences.theme, (theme) => actions.setPreference("theme", theme)),
              preferenceRow<"canvasBackground">("Canvas", "Default viewer canvas background for structure previews.", preferences.canvasBackground, ["auto", "black", "graphite", "white", "transparent"], defaultPreferences.canvasBackground, (canvasBackground) => actions.setPreference("canvasBackground", canvasBackground)),
            ]}
          />
          <SettingsSection
            title="Structure Rendering"
            rows={[
              preferenceRow<"rendererMode">("Mode", "Choose the renderer used for newly opened structures.", preferences.rendererMode, ["auto", "xyz-fast", "molstar", "xyzrender-external"], defaultPreferences.rendererMode, (rendererMode) => actions.setPreference("rendererMode", rendererMode)),
              preferenceRow<"xyzFastStyle">("XYZ style", "Default drawing style for the fast XYZ renderer.", preferences.xyzFastStyle, ["default", "wire", "tube", "spacefill"], defaultPreferences.xyzFastStyle, (xyzFastStyle) => actions.setPreference("xyzFastStyle", xyzFastStyle)),
            ]}
          />
          <SettingsSection title="Updates" rows={updateRows} />
          <SettingsSection
            title="Workspace"
            rows={[
              actionRow("Open structures", state.documents.length + " open, " + state.recentStructures.length + " recent.", "Close all", actions.clearAllDocuments),
              actionRow("Recent structures", "Clear saved recent structure entries.", "Clear", actions.clearRecentStructures, state.recentStructures.length === 0),
            ]}
          />
          <SettingsSection
            title="System"
            rows={[
              actionRow("Quick Look", "Refresh Finder preview registration and cache.", "Reset", () => void actions.resetQuickLook()),
              actionRow("Logs", "Open the Quick Look extension log folder.", "Open", () => void actions.openLogs()),
              actionRow("Preview cache", "Delete generated viewer runtimes except shared assets.", "Clear", () => void actions.clearCache()),
            ]}
          />
        </div>
      </EditorScrollContainer>
    </div>
  );
}
