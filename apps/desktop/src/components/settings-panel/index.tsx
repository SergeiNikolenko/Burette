import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ViewerPreferences } from "../../types";
import type { UpdateChannel } from "../../update";
import { CURRENT_VERSION, defaultUpdatePreferences } from "../../update";
import { settingsSectionLabel, type SettingsSectionId } from "../../lib/settings-sections";
import { defaultPreferences } from "../../stores/settings-store";
import { isTauriRuntime } from "../../lib/tauri";
import { AgentIntegrationPanel } from "../agent-integration-panel";
import { EditorScrollContainer } from "../editor-area/editor-scroll-container";
import { RadixDropdownMenu } from "../radix-menu";
import type { ChemicalEditorTarget, ShellActions, ShellViewState } from "../types";
import type { MenuItemSpec } from "../menu-types";
import {
  SettingsSection,
  ToggleControl,
  actionRow,
  selectPreferenceRow,
  type SettingRow,
} from "./setting-control";
import { KeyboardShortcutsSection } from "./keyboard-shortcuts-section";
import { ThemesSection } from "./themes-section";

const defaultRendererModeOptions: Array<ViewerPreferences["rendererMode"]> = ["auto", "molstar", "xyzrender-external"];
type SettingsPanelLocation = { kind: "settings"; section: SettingsSectionId };
type OpenInDefaultDestination = ViewerPreferences["openInDefaultDestination"];
type OpenDestinationOption = {
  value: OpenInDefaultDestination;
  label: string;
  iconText: string;
  iconUrl?: string;
};

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
  const section = location.section;
  const [openDestinationTargets, setOpenDestinationTargets] = useState<ChemicalEditorTarget[]>([]);
  const openDestinationProbePath = state.activeDocument?.path ?? state.documents[0]?.path ?? "structure.pdb";

  useEffect(() => {
    if (section !== "general") return;
    let disposed = false;
    void actions.listChemicalEditorTargets(openDestinationProbePath).then((targets) => {
      if (!disposed) setOpenDestinationTargets(targets);
    });
    return () => {
      disposed = true;
    };
  }, [actions, openDestinationProbePath, section]);

  const openDestinationRows = useMemo<SettingRow[]>(() => [
    openDestinationPreferenceRow(
      preferences.openInDefaultDestination,
      openDestinationTargets,
      (openInDefaultDestination) => actions.setPreference("openInDefaultDestination", openInDefaultDestination),
    ),
  ], [actions, openDestinationTargets, preferences.openInDefaultDestination]);

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
                      ...openDestinationRows,
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
              {section === "keyboard" ? <KeyboardShortcutsSection /> : null}
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

function openDestinationPreferenceRow(
  value: OpenInDefaultDestination,
  targets: ChemicalEditorTarget[],
  onChange: (value: OpenInDefaultDestination) => void,
): SettingRow {
  return {
    label: "Default open destination",
    description: "Where the Open In control points by default.",
    control: <OpenDestinationControl value={value} targets={targets} onChange={onChange} />,
    reset: () => onChange(defaultPreferences.openInDefaultDestination),
    isModified: value !== defaultPreferences.openInDefaultDestination,
  };
}

function OpenDestinationControl({
  value,
  targets,
  onChange,
}: {
  value: OpenInDefaultDestination;
  targets: ChemicalEditorTarget[];
  onChange: (value: OpenInDefaultDestination) => void;
}) {
  const options = openDestinationOptions(value, targets);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const items: MenuItemSpec[] = options.map((option) => ({
    kind: "item",
    id: `open-destination-${option.value}`,
    text: option.label,
    iconText: option.iconText,
    iconUrl: option.iconUrl,
    action: () => onChange(option.value),
  }));

  return (
    <RadixDropdownMenu
      align="end"
      side="bottom"
      sideOffset={4}
      contentClassName="settings-open-destination-menu"
      items={items}
      trigger={(
        <button type="button" className="settings-open-destination-trigger" aria-label="Default open destination">
          {selected.iconUrl ? (
            <img className="settings-open-destination-icon" src={selected.iconUrl} alt="" aria-hidden="true" />
          ) : (
            <span className="settings-open-destination-icon" aria-hidden="true">{selected.iconText}</span>
          )}
          <span>{selected.label}</span>
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <path d="M3.5 5 6.5 8 9.5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    />
  );
}

function openDestinationOptions(value: OpenInDefaultDestination, targets: ChemicalEditorTarget[]): OpenDestinationOption[] {
  const options: OpenDestinationOption[] = [
    { value: "finder", label: "Finder", iconText: "FI", iconUrl: finderIconUrl() ?? undefined },
    { value: "default-app", label: "Default app", iconText: "DA" },
    ...targets.map((target) => ({
      value: `editor:${target.id}` as OpenInDefaultDestination,
      label: target.name,
      iconText: editorIconText(target.name),
      iconUrl: editorIconUrl(target) ?? undefined,
    })),
  ];
  if (value.startsWith("editor:") && !options.some((option) => option.value === value)) {
    options.push({ value, label: "Saved editor", iconText: "ED" });
  }
  return options;
}

function editorIconUrl(target: ChemicalEditorTarget) {
  if (target.iconUrl) return target.iconUrl;
  if (target.iconPath && isTauriRuntime()) return convertFileSrc(target.iconPath);
  if (!isTauriRuntime() && import.meta.env.DEV) return browserDevIconUrl(target);
  return null;
}

function finderIconUrl() {
  if (!isTauriRuntime() && import.meta.env.DEV) return "/__burette/app-icon/finder.png";
  return null;
}

function browserDevIconUrl(target: ChemicalEditorTarget) {
  const appPath = target.appPath.toLowerCase();
  const name = target.name.toLowerCase();
  if (appPath.includes("maestro.app") || name === "maestro") return "/__burette/app-icon/maestro.png";
  if (appPath.includes("chimerax") || name === "chimerax") return "/__burette/app-icon/chimerax.png";
  if (appPath.includes("pymol.app") || name === "pymol") return "/__burette/app-icon/pymol.png";
  if (appPath.includes("avogadro") || name.startsWith("avogadro")) return "/__burette/app-icon/avogadro2.png";
  if (appPath.includes("datawarrior") || name === "datawarrior") return "/__burette/app-icon/datawarrior.png";
  if (appPath.includes("vesta") || name === "vesta") return "/__burette/app-icon/vesta.png";
  return null;
}

function editorIconText(name: string) {
  const compact = name.replace(/[^a-z0-9]+/giu, " ").trim();
  const parts = compact.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return compact.slice(0, 2).toUpperCase() || "ED";
}
