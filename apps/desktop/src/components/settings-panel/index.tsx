import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ViewerPreferences, XtbSettings } from "../../types";
import type { UpdateChannel } from "../../update";
import { CURRENT_VERSION, defaultUpdatePreferences } from "../../update";
import { settingsSectionLabel, type SettingsSectionId } from "../../lib/settings-sections";
import { defaultPreferences } from "../../stores/settings-store";
import { isTauriRuntime } from "../../lib/tauri";
import { AgentIntegrationPanel } from "../agent-integration-panel";
import { EditorScrollContainer } from "../editor-area/editor-scroll-container";
import { RadixDropdownMenu } from "../radix-menu";
import type { AppSettingsSectionId, ChemicalEditorTarget, ShellActions, ShellViewState } from "../types";
import type { MenuItemSpec } from "../menu-types";
import {
  SettingsSection,
  RangeControl,
  SelectControl,
  ToggleControl,
  actionRow,
  selectPreferenceRow,
  type SettingRow,
} from "./setting-control";
import { KeyboardShortcutsSection } from "./keyboard-shortcuts-section";
import { ThemesSection } from "./themes-section";

const defaultRendererModeOptions: Array<ViewerPreferences["rendererMode"]> = ["auto", "molstar", "xyzrender-external"];
const conformerEngineOptions: Array<ViewerPreferences["conformerEngine"]> = ["datamol", "rdkit"];
type SettingsPanelLocation = { kind: "settings"; section: AppSettingsSectionId };
type OpenInDefaultDestination = ViewerPreferences["openInDefaultDestination"];
type OpenDestinationOption = {
  value: OpenInDefaultDestination;
  label: string;
  iconText: string;
  iconUrl?: string;
};

const FINDER_ICON_PATH = "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/FinderIcon.icns";

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
                    {
                      label: "Desktop preview limit",
                      description: "Maximum source file size the desktop app opens in the structure viewer.",
                      control: <RangeControl value={preferences.desktopPreviewLimitMiB} min={1} max={1024} step={1} suffix="MiB" onChange={(desktopPreviewLimitMiB) => actions.setPreference("desktopPreviewLimitMiB", desktopPreviewLimitMiB)} />,
                      reset: () => actions.setPreference("desktopPreviewLimitMiB", defaultPreferences.desktopPreviewLimitMiB),
                      isModified: preferences.desktopPreviewLimitMiB !== defaultPreferences.desktopPreviewLimitMiB,
                    },
                    preferenceRow<"conformerEngine">("3D engine", "Choose the engine used to generate 3D conformers.", preferences.conformerEngine, conformerEngineOptions, defaultPreferences.conformerEngine, (conformerEngine) => actions.setPreference("conformerEngine", conformerEngine)),
                    {
                      label: "Conformer set candidates",
                      description: "How many conformers to ask the engine for before RMSD pruning.",
                      control: <RangeControl value={preferences.conformerCandidateCount} min={8} max={256} step={8} onChange={(conformerCandidateCount) => actions.setPreference("conformerCandidateCount", conformerCandidateCount)} />,
                      reset: () => actions.setPreference("conformerCandidateCount", defaultPreferences.conformerCandidateCount),
                      isModified: preferences.conformerCandidateCount !== defaultPreferences.conformerCandidateCount,
                    },
                    {
                      label: "Conformer set RMSD pruning",
                      description: "Minimum RMSD used while pruning generated conformer sets. Lower values keep more poses.",
                      control: <RangeControl value={preferences.conformerRmsdCutoff} min={0} max={3} step={0.25} onChange={(conformerRmsdCutoff) => actions.setPreference("conformerRmsdCutoff", conformerRmsdCutoff)} />,
                      reset: () => actions.setPreference("conformerRmsdCutoff", defaultPreferences.conformerRmsdCutoff),
                      isModified: preferences.conformerRmsdCutoff !== defaultPreferences.conformerRmsdCutoff,
                    },
                  ]}
                />
              ) : null}
              {section === "xtb" ? (
                <>
                  <SettingsSection
                    title="xTB Runtime"
                    rows={[
                      actionRow(
                        "Status",
                        state.xtbStatus?.installed ? `Ready${state.xtbStatus.version ? ` · ${state.xtbStatus.version}` : ""}` : state.xtbStatus?.installHint ?? "xTB status has not been checked.",
                        "Check",
                        () => void actions.checkXtbStatus(),
                      ),
                      actionRow(
                        "Executable",
                        state.xtbStatus?.executablePath
                          ? `${state.xtbStatus.executablePath}${state.xtbStatus.source ? ` · ${state.xtbStatus.source}` : ""}`
                          : "No xTB executable found.",
                        "Use Existing…",
                        () => void actions.chooseXtbExecutable(),
                      ),
                      actionRow(
                        "Selection",
                        state.xtbStatus?.selectedExecutablePath ? "An explicit executable is selected." : "Burrete is discovering xTB automatically.",
                        "Use Automatically",
                        () => void actions.clearXtbExecutableSelection(),
                        !state.xtbStatus?.selectedExecutablePath,
                      ),
                      actionRow(
                        "Managed Runtime",
                        "Install xTB in an isolated Burrete environment.",
                        "Install Managed",
                        () => void actions.installXtb(),
                      ),
                      actionRow(
                        "Runs",
                        state.xtbStatus?.installer ? `Runtime source: ${state.xtbStatus.source ?? state.xtbStatus.installer}` : "Open recent and active xTB jobs.",
                        "Jobs",
                        () => {
                          actions.openDockTab("bottom", "jobs");
                          actions.setDockActiveTab("bottom", "jobs");
                          actions.setDockOpen("bottom", true);
                        },
                      ),
                    ]}
                  />
                  <SettingsSection
                    title="Calculation Defaults"
                    rows={xtbSettingsRows(state.xtbSettings, actions.setXtbSettings)}
                  />
                </>
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
                    actionRow("Runtime doctor", "Check external runtime availability for molecular workflows.", "Run", () => void actions.runExternalRuntimeDoctor()),
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

const defaultXtbSettings: XtbSettings = {
  method: "gfn2",
  optLevel: "normal",
  solvationModel: "none",
  solvent: "none",
  charge: 0,
  uhf: 0,
  threads: 0,
  accuracy: 1,
  electronicTemperature: 300,
  properties: {
    dipole: true,
    wbo: true,
    population: false,
    molden: false,
    alpha: false,
    fod: false,
    esp: false,
    fukui: false,
  },
  mdTemperature: 298,
  mdTimePs: 2,
  mdStepFs: 1,
  mdSnapshots: 100,
  timeoutSeconds: 180,
  saveRunFiles: true,
};

function xtbSettingsRows(
  settings: XtbSettings,
  onChange: (settings: XtbSettings) => void,
): SettingRow[] {
  const update = <K extends keyof XtbSettings>(key: K, value: XtbSettings[K]) => onChange({ ...settings, [key]: value });
  return [
    {
      label: "Method",
      description: "GFN2 is the default for small-molecule single-point and optimization jobs.",
      control: <SelectControl value={settings.method} options={["gfn2", "gfn1", "gfn0", "gfnff"]} onChange={(method) => update("method", method as XtbSettings["method"])} />,
      reset: () => update("method", defaultXtbSettings.method),
      isModified: settings.method !== defaultXtbSettings.method,
    },
    {
      label: "Solvent",
      description: "Solvent name for ALPB, GBSA, COSMO, or CPCM-X.",
      control: <SelectControl value={settings.solvent} options={["none", "water", "acetone", "acetonitrile", "benzene", "ch2cl2", "chcl3", "dmf", "dmso", "ether", "hexane", "methanol", "toluene", "thf"]} onChange={(solvent) => update("solvent", solvent)} />,
      reset: () => update("solvent", defaultXtbSettings.solvent),
      isModified: settings.solvent !== defaultXtbSettings.solvent,
    },
    {
      label: "Solvation model",
      description: "Continuum solvation model passed to xTB.",
      control: <SelectControl value={settings.solvationModel} options={["none", "alpb", "gbsa", "cosmo", "cpcmx"]} onChange={(solvationModel) => update("solvationModel", solvationModel as XtbSettings["solvationModel"])} />,
      reset: () => update("solvationModel", defaultXtbSettings.solvationModel),
      isModified: settings.solvationModel !== defaultXtbSettings.solvationModel,
    },
    {
      label: "Optimization level",
      description: "Geometry optimization level for --opt and --ohess.",
      control: <SelectControl value={settings.optLevel} options={["loose", "normal", "tight", "verytight"]} onChange={(optLevel) => update("optLevel", optLevel as XtbSettings["optLevel"])} />,
      reset: () => update("optLevel", defaultXtbSettings.optLevel),
      isModified: settings.optLevel !== defaultXtbSettings.optLevel,
    },
    {
      label: "Charge",
      description: "Total molecular charge passed as --chrg.",
      control: <RangeControl value={settings.charge} min={-5} max={5} step={1} onChange={(charge) => update("charge", charge)} />,
      reset: () => update("charge", defaultXtbSettings.charge),
      isModified: settings.charge !== defaultXtbSettings.charge,
    },
    {
      label: "Unpaired electrons",
      description: "Spin setting passed as --uhf.",
      control: <RangeControl value={settings.uhf} min={0} max={10} step={1} onChange={(uhf) => update("uhf", uhf)} />,
      reset: () => update("uhf", defaultXtbSettings.uhf),
      isModified: settings.uhf !== defaultXtbSettings.uhf,
    },
    {
      label: "Threads",
      description: "Passed as --parallel and OMP_NUM_THREADS. Zero leaves xTB automatic.",
      control: <RangeControl value={settings.threads} min={0} max={32} step={1} onChange={(threads) => update("threads", threads)} />,
      reset: () => update("threads", defaultXtbSettings.threads),
      isModified: settings.threads !== defaultXtbSettings.threads,
    },
    {
      label: "Accuracy",
      description: "SCC accuracy passed as --acc; lower is more strict.",
      control: <RangeControl value={settings.accuracy} min={0.05} max={10} step={0.05} onChange={(accuracy) => update("accuracy", accuracy)} />,
      reset: () => update("accuracy", defaultXtbSettings.accuracy),
      isModified: settings.accuracy !== defaultXtbSettings.accuracy,
    },
    {
      label: "Electronic temperature",
      description: "Electronic temperature in Kelvin passed as --etemp.",
      control: <RangeControl value={settings.electronicTemperature} min={50} max={5000} step={50} onChange={(electronicTemperature) => update("electronicTemperature", electronicTemperature)} />,
      reset: () => update("electronicTemperature", defaultXtbSettings.electronicTemperature),
      isModified: settings.electronicTemperature !== defaultXtbSettings.electronicTemperature,
    },
    {
      label: "MD temperature",
      description: "Thermostat temperature in Kelvin for MD and metadynamics.",
      control: <RangeControl value={settings.mdTemperature} min={50} max={2000} step={10} onChange={(mdTemperature) => update("mdTemperature", mdTemperature)} />,
      reset: () => update("mdTemperature", defaultXtbSettings.mdTemperature),
      isModified: settings.mdTemperature !== defaultXtbSettings.mdTemperature,
    },
    {
      label: "MD time",
      description: "Total dynamics length in picoseconds. Longer runs produce longer trajectories.",
      control: <RangeControl value={settings.mdTimePs} min={0.05} max={100} step={0.05} onChange={(mdTimePs) => update("mdTimePs", mdTimePs)} />,
      reset: () => update("mdTimePs", defaultXtbSettings.mdTimePs),
      isModified: settings.mdTimePs !== defaultXtbSettings.mdTimePs,
    },
    {
      label: "MD step",
      description: "Integration step in femtoseconds for MD and metadynamics.",
      control: <RangeControl value={settings.mdStepFs} min={0.1} max={10} step={0.1} onChange={(mdStepFs) => update("mdStepFs", mdStepFs)} />,
      reset: () => update("mdStepFs", defaultXtbSettings.mdStepFs),
      isModified: settings.mdStepFs !== defaultXtbSettings.mdStepFs,
    },
    {
      label: "Trajectory snapshots",
      description: "Requested trajectory frame count for MD/metadyn output and the metadynamics bias snapshot count.",
      control: <RangeControl value={settings.mdSnapshots} min={1} max={1000} step={1} onChange={(mdSnapshots) => update("mdSnapshots", mdSnapshots)} />,
      reset: () => update("mdSnapshots", defaultXtbSettings.mdSnapshots),
      isModified: settings.mdSnapshots !== defaultXtbSettings.mdSnapshots,
    },
    {
      label: "Save run files",
      description: "Store xTB run directories such as xtb_optimize_N next to the input structure. Turn off to use temporary storage.",
      control: <ToggleControl label="Save xTB run files" checked={settings.saveRunFiles} onChange={(saveRunFiles) => update("saveRunFiles", saveRunFiles)} />,
      reset: () => update("saveRunFiles", defaultXtbSettings.saveRunFiles),
      isModified: settings.saveRunFiles !== defaultXtbSettings.saveRunFiles,
    },
    {
      label: "Timeout",
      description: "Maximum runtime for ordinary xTB jobs in seconds.",
      control: <RangeControl value={settings.timeoutSeconds} min={30} max={1200} step={30} onChange={(timeoutSeconds) => update("timeoutSeconds", timeoutSeconds)} />,
      reset: () => update("timeoutSeconds", defaultXtbSettings.timeoutSeconds),
      isModified: settings.timeoutSeconds !== defaultXtbSettings.timeoutSeconds,
    },
  ];
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
  if (isTauriRuntime()) return convertFileSrc(FINDER_ICON_PATH);
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
