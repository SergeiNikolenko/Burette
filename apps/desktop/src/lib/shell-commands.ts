import type { ShellActions, ShellViewState } from "../components/types";
import { parsePdbFetchCommand, parseSmilesCommand } from "./structure-fetch";
import type { ViewerPreferences } from "../types";

export type ShellCommand = {
  id: string;
  group: string;
  label: string;
  description: string;
  run: () => void | Promise<void>;
};

const rendererCommands: Array<{
  id: string;
  label: string;
  value: ViewerPreferences["rendererMode"];
}> = [
  { id: "renderer-auto", label: "Renderer: Auto", value: "auto" },
  { id: "renderer-molstar", label: "Renderer: Mol*", value: "molstar" },
  { id: "renderer-xyzrender", label: "Renderer: xyzrender external", value: "xyzrender-external" },
];

function promptRemoteStructureUrl(actions: ShellActions) {
  const url = window.prompt("Structure URL");
  if (!url?.trim()) return;
  return actions.openStructureUrlInMolstar(url);
}

export function buildShellCommands(
  state: ShellViewState,
  actions: ShellActions,
  query: string,
): ShellCommand[] {
  return [
    {
      id: "open-structure",
      group: "Suggested",
      label: "Open Structure",
      description: "Choose molecular structure files",
      run: actions.chooseFiles,
    },
    ...shellCommandsForQuery(query, actions),
    {
      id: "open-clipboard",
      group: "Suggested",
      label: "Open from Clipboard",
      description: "Open molecular text or copied structure paths",
      run: actions.openClipboard,
    },
    {
      id: "fetch-structure-url",
      group: "Suggested",
      label: "Fetch Structure URL in Mol*",
      description: "Download a remote structure URL into Mol*",
      run: () => promptRemoteStructureUrl(actions),
    },
    {
      id: "new-window",
      group: "Suggested",
      label: "New Window",
      description: "Open another Burette workspace window",
      run: actions.openNewWindow,
    },
    {
      id: "open-recent",
      group: "Suggested",
      label: "Open Recent",
      description: "Open the most recent structure",
      run: actions.openMostRecentStructure,
    },
    {
      id: "search-projects",
      group: "Suggested",
      label: "Search Projects and Structures",
      description: "Focus project and structure search",
      run: actions.focusSidebarSearch,
    },
    {
      id: "open-settings",
      group: "Suggested",
      label: "Settings",
      description: "Open Burette settings",
      run: actions.openSettings,
    },
    {
      id: "open-ketcher",
      group: "Suggested",
      label: "Ketcher",
      description: "Open molecule sketch tab",
      run: actions.openKetcher,
    },
    {
      id: "open-fep-network",
      group: "Suggested",
      label: "FEP Network Preview",
      description: "Open the ligand network graph workspace",
      run: actions.openFepNetworkPreview,
    },
    {
      id: "open-agent-integration",
      group: "Suggested",
      label: "Codex Agent",
      description: "Open MCP plugin status",
      run: () => actions.openSettingsSection("agent"),
    },
    {
      id: "toggle-sidebar",
      group: "Suggested",
      label: state.sidebarOpen ? "Hide Sidebar" : "Show Sidebar",
      description: "Toggle the molecule browser",
      run: actions.toggleSidebar,
    },
    {
      id: "close-active",
      group: "Suggested",
      label: "Close Active Tab",
      description: "Close the selected tab",
      run: actions.closeActiveDocument,
    },
    {
      id: "close-all",
      group: "Suggested",
      label: "Close All Tabs",
      description: "Close every open workspace tab",
      run: actions.clearAllDocuments,
    },
    {
      id: "clear-recent",
      group: "Suggested",
      label: "Clear Recent Structures",
      description: "Forget the recent structure list",
      run: actions.clearRecentStructures,
    },
    {
      id: "clear-cache",
      group: "Suggested",
      label: "Clear Preview Cache",
      description: "Remove generated preview runtimes",
      run: actions.clearCache,
    },
    {
      id: "reveal-active",
      group: "Active Structure",
      label: "Reveal in Finder",
      description: "Show the active structure in Finder",
      run: actions.revealActiveDocument,
    },
    {
      id: "copy-active-path",
      group: "Active Structure",
      label: "Copy Path",
      description: "Copy the active structure path",
      run: actions.copyActiveDocumentPath,
    },
    {
      id: "show-active-metadata",
      group: "Active Structure",
      label: "Get Info",
      description: "Show active structure path, renderer, format, and size",
      run: actions.showActiveDocumentMetadata,
    },
    {
      id: "export-preview-png",
      group: "Active Structure",
      label: "Export Preview as PNG",
      description: "Save the active external SVG preview as PNG",
      run: actions.exportActivePreviewAsPng,
    },
    {
      id: "export-preview-svg",
      group: "Active Structure",
      label: "Export Preview as SVG",
      description: "Save the active external SVG preview",
      run: actions.exportActivePreviewAsSvg,
    },
    {
      id: "reset-quicklook",
      group: "Suggested",
      label: "Reset Quick Look",
      description: "Refresh Finder preview registration",
      run: actions.resetQuickLook,
    },
    {
      id: "open-logs",
      group: "Suggested",
      label: "Open Logs Folder",
      description: "Show Burette runtime logs",
      run: actions.openLogs,
    },
    {
      id: "export-diagnostics",
      group: "Suggested",
      label: "Export Diagnostics",
      description: "Save logs, environment, size report, and performance marks",
      run: actions.exportDiagnostics,
    },
    {
      id: "runtime-doctor",
      group: "Suggested",
      label: "Runtime Doctor",
      description: "Check external molecular runtime availability",
      run: actions.runExternalRuntimeDoctor,
    },
    {
      id: "check-updates",
      group: "Suggested",
      label: "Check for Updates",
      description: "Check Burette releases",
      run: actions.checkForUpdates,
    },
    ...rendererCommands.map((command) => ({
      id: command.id,
      group: "Renderer",
      label: command.label,
      description: state.preferences.rendererMode === command.value ? "Current renderer mode" : "Switch renderer mode",
      run: () => actions.setPreference("rendererMode", command.value),
    })),
  ];
}

export function shellCommandsForQuery(query: string, actions: ShellActions): ShellCommand[] {
  const fetchCommand = parsePdbFetchCommand(query);
  const smilesCommand = parseSmilesCommand(query);
  const items: ShellCommand[] = [];
  if (fetchCommand) {
    items.push({
      id: `fetch-pdb-${fetchCommand.pdbId}`,
      group: "Commands",
      label: `Fetch ${fetchCommand.pdbId} from RCSB PDB`,
      description: `Command: ${fetchCommand.command} · Download and open in Molstar`,
      run: () => actions.fetchPdbStructure(fetchCommand.pdbId),
    });
  }
  if (smilesCommand) {
    const title = smilesTitle(smilesCommand.smiles);
    items.push({
      id: `draw-smiles-${smilesCommand.smiles}`,
      group: "Commands",
      label: `Draw SMILES in Ketcher: ${shortCommandValue(smilesCommand.smiles)}`,
      description: `Command: ${smilesCommand.command} · Import SMILES into the molecule sketcher`,
      run: () => actions.openKetcherWithStructures([], [{
        title,
        text: `${smilesCommand.smiles}\n`,
      }]),
    });
  }
  return items;
}

export function filterShellCommands<T extends ShellCommand>(commands: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter((command) => (
    command.label.toLowerCase().includes(normalized)
    || command.description.toLowerCase().includes(normalized)
  ));
}

function smilesTitle(smiles: string) {
  return `${shortCommandValue(smiles).replace(/[^a-z0-9_.-]+/giu, "-") || "smiles"}.smi`;
}

function shortCommandValue(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 48 ? `${trimmed.slice(0, 45)}...` : trimmed;
}
