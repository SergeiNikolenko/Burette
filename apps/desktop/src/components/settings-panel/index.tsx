import type { ViewerPreferences } from "../../types";
import type { UpdateChannel } from "../../update";
import { CURRENT_VERSION } from "../../update";
import type { ShellActions, ShellViewState } from "../types";
import { SettingSelect, SettingSwitch, SettingsActionButton } from "./setting-control";

export function SettingsPanel({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const preferences = state.preferences;
  const update = state.update;
  return (
    <div className="settings-page">
      <h1>Preferences</h1>
      <section>
        <h2>Appearance</h2>
        <div className="settings-card">
          <SettingSelect label="Theme" value={preferences.theme} onChange={(value) => actions.setPreference("theme", value as ViewerPreferences["theme"])} options={["auto", "dark", "light"]} />
          <SettingSelect label="Canvas" value={preferences.canvasBackground} onChange={(value) => actions.setPreference("canvasBackground", value as ViewerPreferences["canvasBackground"])} options={["auto", "black", "graphite", "white", "transparent"]} />
        </div>
      </section>
      <section>
        <h2>Renderer</h2>
        <div className="settings-card">
          <SettingSelect label="Mode" value={preferences.rendererMode} onChange={(value) => actions.setPreference("rendererMode", value as ViewerPreferences["rendererMode"])} options={["auto", "xyz-fast", "molstar", "xyzrender-external"]} />
          <SettingSelect label="XYZ style" value={preferences.xyzFastStyle} onChange={(value) => actions.setPreference("xyzFastStyle", value as ViewerPreferences["xyzFastStyle"])} options={["default", "wire", "tube", "spacefill"]} />
        </div>
      </section>
      <section>
        <h2>Updates</h2>
        <div className="settings-card">
          <SettingSwitch
            label="Automatic checks"
            checked={update.preferences.checkAutomatically}
            onChange={(checked) => actions.setUpdatePreferences({ ...update.preferences, checkAutomatically: checked })}
          />
          <SettingSelect
            label="Channel"
            value={update.preferences.channel}
            onChange={(value) => actions.setUpdatePreferences({ ...update.preferences, channel: value as UpdateChannel })}
            options={["stable", "beta"]}
          />
          <div className="settings-action-row">
            <span>{update.statusText}</span>
            <SettingsActionButton onClick={() => void actions.checkForUpdates()} disabled={update.isChecking}>{update.isChecking ? "Checking..." : "Check for Updates"}</SettingsActionButton>
          </div>
          {update.availableRelease && (
            <div className="settings-action-row">
              <span>{update.availableRelease.installAsset ? update.availableRelease.installAsset.name : "Current " + CURRENT_VERSION + ", latest " + update.availableRelease.tagName}</span>
              <SettingsActionButton onClick={() => void actions.installUpdate()} disabled={update.isInstalling}>
                {update.availableRelease.installAsset ? (update.isInstalling ? "Installing..." : "Install and Restart") : "Open Release Page"}
              </SettingsActionButton>
            </div>
          )}
        </div>
      </section>
      <section>
        <h2>Session</h2>
        <div className="settings-card">
          <div className="settings-action-row">
            <span>{state.documents.length} open, {state.recentStructures.length} recent</span>
            <SettingsActionButton onClick={actions.clearAllDocuments}>Close all structures</SettingsActionButton>
          </div>
          <div className="settings-action-row">
            <span>Recent structures</span>
            <SettingsActionButton onClick={actions.clearRecentStructures} disabled={state.recentStructures.length === 0}>Clear Recent</SettingsActionButton>
          </div>
        </div>
      </section>
      <section>
        <h2>Quick Look</h2>
        <div className="settings-card">
          <div className="settings-action-row">
            <span>Finder preview registration and extension logs</span>
            <span className="settings-button-group">
              <SettingsActionButton onClick={() => void actions.resetQuickLook()}>Reset Quick Look</SettingsActionButton>
              <SettingsActionButton onClick={() => void actions.openLogs()}>Open Logs Folder</SettingsActionButton>
            </span>
          </div>
        </div>
      </section>
      <section>
        <h2>Maintenance</h2>
        <div className="settings-card">
          <div className="settings-action-row">
            <span>Generated preview runtime cache</span>
            <SettingsActionButton onClick={() => void actions.clearCache()}>Clear preview cache</SettingsActionButton>
          </div>
        </div>
      </section>
    </div>
  );
}
