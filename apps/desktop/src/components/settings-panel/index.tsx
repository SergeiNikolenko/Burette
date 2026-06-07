import type { ViewerPreferences } from "../../types";
import type { UpdateChannel } from "../../update";
import { CURRENT_VERSION, defaultUpdatePreferences } from "../../update";
import { settingsSectionLabel, type SettingsSectionId } from "../../lib/settings-sections";
import { defaultPreferences } from "../../stores/settings-store";
import { AgentIntegrationPanel } from "../agent-integration-panel";
import { EditorScrollContainer } from "../editor-area/editor-scroll-container";
import type { ShellActions, ShellViewState } from "../types";
import {
  SettingsSection,
  ToggleControl,
  actionRow,
  selectPreferenceRow,
  type SettingRow,
} from "./setting-control";
import { ThemesSection } from "./themes-section";

const defaultRendererModeOptions: Array<ViewerPreferences["rendererMode"]> = ["auto", "molstar", "xyzrender-external"];
type SettingsPanelLocation = { kind: "settings"; section: SettingsSectionId };

function preferenceRow<K extends Extract<keyof ViewerPreferences, string>>(
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

export function SettingsPanel({ location, state, actions }: { location: SettingsPanelLocation; state: ShellViewState; actions: ShellActions }) {
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

  const section = location.section;
  return (
    <div className="settings-panel" data-settings-panel data-settings-section={section}>
      <EditorScrollContainer>
        <div className="settings-panel-content">
          {section === "agent" ? (
            <AgentIntegrationPanel embedded />
          ) : (
            <>
              <h1>{settingsSectionLabel(section)}</h1>
              {section === "general" ? (
                <>
                  <SettingsSection
                    title="Work mode"
                    rows={[
                      actionRow("Open structures", state.documents.length + " open structures in this workspace.", "Choose Files", () => void actions.chooseFiles()),
                      actionRow("Most recent structure", state.recentStructures[0]?.title ?? "No recent structures saved.", "Open", actions.openMostRecentStructure, state.recentStructures.length === 0),
                    ]}
                  />
                  <SettingsSection
                    title="Current session"
                    rows={[
                      actionRow("Open tabs", state.tabs.length + " tabs, " + state.documents.length + " structure documents.", "Close All", actions.clearAllDocuments, state.documents.length === 0, true),
                    ]}
                  />
                </>
              ) : null}
              {section === "appearance" ? (
                <>
                  <SettingsSection
                    title="Display"
                    rows={[
                      preferenceRow<"theme">("Theme", "Match the system, force dark mode, or force light mode.", preferences.theme, ["auto", "dark", "light"], defaultPreferences.theme, (theme) => actions.setPreference("theme", theme)),
                      preferenceRow<"canvasBackground">("Canvas", "Default viewer canvas background for structure previews.", preferences.canvasBackground, ["auto", "black", "graphite", "white", "transparent"], defaultPreferences.canvasBackground, (canvasBackground) => actions.setPreference("canvasBackground", canvasBackground)),
                    ]}
                  />
                  <ThemesSection preferences={preferences} actions={actions} />
                </>
              ) : null}
              {section === "structure" ? (
                <SettingsSection
                  title="Structure Rendering"
                  rows={[
                    preferenceRow<"rendererMode">("Mode", "Choose the renderer used for newly opened structures.", preferences.rendererMode, defaultRendererModeOptions, defaultPreferences.rendererMode, (rendererMode) => actions.setPreference("rendererMode", rendererMode)),
                    preferenceRow<"molstarStyle">("Mol* style", "Default appearance preset for the Mol* renderer.", preferences.molstarStyle, ["default", "illustrative"], defaultPreferences.molstarStyle, (molstarStyle) => actions.setPreference("molstarStyle", molstarStyle)),
                  ]}
                />
              ) : null}
              {section === "updates" ? <SettingsSection title="Updates" rows={updateRows} /> : null}
              {section === "workspace" ? (
                <SettingsSection
                  title="Files and Projects"
                  rows={[
                    actionRow("Project folder", state.workspacePath ?? "No active project folder.", "Open", () => void actions.openWorkspaceFolder(), !state.workspacePath),
                    actionRow("Add project folder", "Choose a folder to show in the sidebar project list.", "Choose", () => void actions.chooseWorkspace()),
                    actionRow("Recent structures", "Clear saved recent structure entries.", "Clear", actions.clearRecentStructures, state.recentStructures.length === 0, true),
                  ]}
                />
              ) : null}
              {section === "maintenance" ? (
                <SettingsSection
                  title="System"
                  rows={[
                    actionRow("Quick Look", "Refresh Finder preview registration and cache.", "Reset", () => void actions.resetQuickLook(), false, true),
                    actionRow("Logs", "Open the Quick Look extension log folder.", "Open", () => void actions.openLogs()),
                    actionRow("Diagnostics", "Export logs, environment, size report, performance marks, and recent errors.", "Export", () => void actions.exportDiagnostics()),
                    actionRow("Preview cache", "Delete generated viewer runtimes except shared assets.", "Clear", () => void actions.clearCache(), false, true),
                  ]}
                />
              ) : null}
            </>
          )}
        </div>
      </EditorScrollContainer>
    </div>
  );
}
