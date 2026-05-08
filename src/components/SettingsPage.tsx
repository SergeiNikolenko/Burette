import type { ViewerPreferences } from "../types";
import type { UpdateChannel } from "../update";
import { CURRENT_VERSION } from "../update";
import type { ShellActions, ShellViewState } from "./types";

export function SettingsPage({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const preferences = state.preferences;
  const update = state.update;
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <section>
        <h2>Appearance</h2>
        <SettingSelect label="Theme" value={preferences.theme} onChange={(value) => actions.setPreference("theme", value as ViewerPreferences["theme"])} options={["auto", "dark", "light"]} />
        <SettingSelect label="Canvas" value={preferences.canvasBackground} onChange={(value) => actions.setPreference("canvasBackground", value as ViewerPreferences["canvasBackground"])} options={["auto", "black", "graphite", "white", "transparent"]} />
      </section>
      <section>
        <h2>Renderer</h2>
        <SettingSelect label="Mode" value={preferences.rendererMode} onChange={(value) => actions.setPreference("rendererMode", value as ViewerPreferences["rendererMode"])} options={["auto", "xyz-fast", "molstar", "xyzrender-external"]} />
        <SettingSelect label="XYZ style" value={preferences.xyzFastStyle} onChange={(value) => actions.setPreference("xyzFastStyle", value as ViewerPreferences["xyzFastStyle"])} options={["default", "wire", "tube", "spacefill"]} />
      </section>
      <section>
        <h2>Updates</h2>
        <label className="setting-row">
          <span>Automatic checks</span>
          <input
            type="checkbox"
            checked={update.preferences.checkAutomatically}
            onChange={(event) => actions.setUpdatePreferences({ ...update.preferences, checkAutomatically: event.target.checked })}
          />
        </label>
        <SettingSelect
          label="Channel"
          value={update.preferences.channel}
          onChange={(value) => actions.setUpdatePreferences({ ...update.preferences, channel: value as UpdateChannel })}
          options={["stable", "beta"]}
        />
        <div className="settings-action-row">
          <span>{update.statusText}</span>
          <button onClick={() => void actions.checkForUpdates()} disabled={update.isChecking}>{update.isChecking ? "Checking..." : "Check for Updates"}</button>
        </div>
        {update.availableRelease && (
          <div className="settings-action-row">
            <span>{update.availableRelease.installAsset ? update.availableRelease.installAsset.name : "Current " + CURRENT_VERSION + ", latest " + update.availableRelease.tagName}</span>
            <button onClick={() => void actions.openUpdateRelease()}>Open Release Page</button>
          </div>
        )}
      </section>
      <section>
        <h2>Maintenance</h2>
        <button onClick={actions.clearAllDocuments}>Close all structures</button>
        <button onClick={() => void actions.clearCache()}>Clear preview cache</button>
        <button onClick={() => void actions.resetQuickLook()}>Reset Quick Look</button>
      </section>
    </div>
  );
}

function SettingSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}
