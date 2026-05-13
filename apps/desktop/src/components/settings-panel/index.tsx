import { defaultPreferences } from "../../store";
import { getSettingsByCategory } from "../../lib/settings-schema";
import type { ViewerPreferences } from "../../types";
import type { UpdateChannel } from "../../update";
import { CURRENT_VERSION, defaultUpdatePreferences } from "../../update";
import type { ShellActions, ShellViewState } from "../types";
import { EditorScrollContainer } from "../editor-area/editor-scroll-container";
import {
  SelectControl,
  SettingsSection,
  ToggleControl,
  actionRow,
  selectPreferenceRow,
  type SettingRow,
} from "./setting-control";
import { ThemesSection } from "./themes-section";

function enumPreferenceRow<K extends keyof ViewerPreferences & string>(
  key: K,
  value: ViewerPreferences[K],
  onChange: (key: K, value: ViewerPreferences[K]) => void,
): SettingRow | null {
  const definition = getSettingsByCategory("appearance")
    .concat(getSettingsByCategory("renderer"))
    .find((candidate) => candidate.key === key);
  if (!definition || definition.type !== "enum" || !definition.options) return null;
  return selectPreferenceRow(
    definition.label,
    definition.description,
    String(value),
    definition.options,
    String(definition.default),
    (next) => onChange(key, next as ViewerPreferences[K]),
  );
}

export function SettingsPage({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const preferences = state.preferences;
  const update = state.update;

  const setPreference = <K extends keyof ViewerPreferences & string>(key: K, value: ViewerPreferences[K]) => {
    actions.setPreference(key, value);
  };

  const appearanceRows: SettingRow[] = (["theme", "canvasBackground"] as const)
    .map((key) => enumPreferenceRow(key, preferences[key], setPreference))
    .filter((row): row is SettingRow => row !== null);

  const rendererRows: SettingRow[] = (["rendererMode", "xyzFastStyle"] as const)
    .map((key) => enumPreferenceRow(key, preferences[key], setPreference))
    .filter((row): row is SettingRow => row !== null);

  const updateRows: SettingRow[] = [
    {
      label: "Automatic checks",
      description: "Check GitHub releases in the background.",
      control: (
        <ToggleControl
          checked={update.preferences.checkAutomatically}
          onChange={(checked) =>
            actions.setUpdatePreferences({ ...update.preferences, checkAutomatically: checked })
          }
        />
      ),
      reset: () =>
        actions.setUpdatePreferences({
          ...update.preferences,
          checkAutomatically: defaultUpdatePreferences.checkAutomatically,
        }),
      isModified:
        update.preferences.checkAutomatically !== defaultUpdatePreferences.checkAutomatically,
    },
    {
      label: "Channel",
      description: "Stable ignores prereleases; beta includes them.",
      control: (
        <SelectControl
          value={update.preferences.channel}
          options={["stable", "beta"]}
          onChange={(value) =>
            actions.setUpdatePreferences({ ...update.preferences, channel: value as UpdateChannel })
          }
        />
      ),
      reset: () =>
        actions.setUpdatePreferences({
          ...update.preferences,
          channel: defaultUpdatePreferences.channel,
        }),
      isModified: update.preferences.channel !== defaultUpdatePreferences.channel,
    },
    {
      label: "Version",
      description: update.statusText,
      control: (
        <button
          type="button"
          className="settings-action-button"
          onClick={() => void actions.checkForUpdates()}
          disabled={update.isChecking}
        >
          {update.isChecking ? "Checking..." : "Check for Updates"}
        </button>
      ),
    },
  ];

  if (update.availableRelease) {
    updateRows.push({
      label: "Available release",
      description: update.availableRelease.installAsset
        ? update.availableRelease.installAsset.name
        : "Current " + CURRENT_VERSION + ", latest " + update.availableRelease.tagName,
      control: (
        <button
          type="button"
          className="settings-action-button"
          onClick={() => void actions.openUpdateRelease()}
        >
          Open Release Page
        </button>
      ),
    });
  }

  return (
    <div className="settings-panel" data-settings-panel>
      <EditorScrollContainer>
        <div className="settings-panel-content">
          <h1>Preferences</h1>
          <SettingsSection title="Appearance" rows={appearanceRows} />
          <ThemesSection
            preferences={preferences}
            defaults={defaultPreferences}
            onChange={(themeOverrides) => actions.setPreference("themeOverrides", themeOverrides)}
          />
          <SettingsSection title="Renderer" rows={rendererRows} />
          <SettingsSection title="Updates" rows={updateRows} />
          <SettingsSection
            title="Maintenance"
            rows={[
              actionRow("Close all structures", "Remove every open structure tab.", actions.clearAllDocuments),
              actionRow("Clear preview cache", "Delete generated viewer runtimes except shared assets.", () => void actions.clearCache()),
              actionRow("Reset Quick Look", "Refresh Quick Look registration and cache.", () => void actions.resetQuickLook()),
            ]}
          />
        </div>
      </EditorScrollContainer>
    </div>
  );
}
