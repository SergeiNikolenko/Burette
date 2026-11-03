import { useMemo, useSyncExternalStore } from "react";
import type { ShellActions } from "../../components/types";
import type { ViewerDocument } from "../../types";
import { isTauriRuntime } from "../tauri";
import { readWorkbenchAgentSource } from "../workbench/agent-source";
import { viewerAtomSelection } from "../workbench/selection";
import { readMolecularStructure, readWorkbenchSource, workbenchSupportsDocument } from "../workbench/structure";
import { commandInput, readCommandOutput, type CommandOptionValue } from "./avogadro-command-io";
import { readPluginManifest, type PluginCommand } from "./avogadro-plugin-manifest";
import { avogadroPluginRunner, type InstalledAvogadroPlugin } from "./avogadro-plugin-runner";

export type AvogadroCommandEntry = {
  id: string;
  plugin: InstalledAvogadroPlugin;
  script: string;
  command: PluginCommand;
  /** Submenu path without Avogadro's top-level "Extensions" menu, then the item. */
  path: string[];
};
type Runner = ReturnType<typeof avogadroPluginRunner>;
type Actions = Pick<ShellActions, "openStructureRecords" | "runStructureViewerAction">;
export type CommandNotice = { kind: "success" | "info" | "warning" | "error"; title: string; description?: string };

/** Commands of prepared plugins, in package and declaration order. */
export function availableCommands(installed: readonly InstalledAvogadroPlugin[]): AvogadroCommandEntry[] {
  return installed.filter(plugin => plugin.prepared).flatMap(plugin => {
    const manifest = readPluginManifest(plugin.pyproject);
    if (!manifest?.script) return [];
    return manifest.commands.map(command => ({ id: `${plugin.name}:${command.identifier}`, plugin, script: manifest.script!, command,
      path: [...command.menuPath.filter((part, index) => index > 0 || part !== "Extensions"), command.label] }));
  });
}

const noInstalled: readonly InstalledAvogadroPlugin[] = [];
const subscribeNothing = () => () => {};

/** Desktop only: the commands that can run on this document. */
export function useAvogadroCommands(document: ViewerDocument | null): AvogadroCommandEntry[] {
  const runner = isTauriRuntime() ? avogadroPluginRunner() : undefined;
  const installed = useSyncExternalStore(runner?.subscribe ?? subscribeNothing, () => runner?.getSnapshot().installed ?? noInstalled, () => noInstalled);
  const supported = workbenchSupportsDocument(document);
  return useMemo(() => supported ? availableCommands(installed) : [], [supported, installed]);
}

export type AvogadroCommandRequest = {
  entry: AvogadroCommandEntry; document: ViewerDocument; selectedAtoms: readonly number[];
  /** The viewer reported only part of a large selection, so none is passed. */
  selectionTruncated: boolean;
};
let request: AvogadroCommandRequest | null = null;
const listeners = new Set<() => void>();
export function requestAvogadroCommand(next: AvogadroCommandRequest | null) { request = next; listeners.forEach(listener => listener()); }
/** Starts a command on the document with its current 3D selection. */
export function startAvogadroCommand(entry: AvogadroCommandEntry, document: ViewerDocument) {
  const selection = viewerAtomSelection(document.id);
  requestAvogadroCommand({ entry, document, selectedAtoms: selection && !selection.truncated ? selection.atoms : [], selectionTruncated: Boolean(selection?.truncated) });
}
export function useAvogadroCommandRequest() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => request, () => null);
}

/**
 * Runs a command on the document's current source and publishes its result:
 * a returned molecule opens as a new document, returned atom indices become
 * the viewer selection, and the command's own messages become notices.
 */
export async function runAvogadroCommand(request: AvogadroCommandRequest, options: Record<string, CommandOptionValue>,
  actions: Actions, runner: Runner = avogadroPluginRunner()): Promise<CommandNotice[]> {
  const { entry, document, selectedAtoms } = request;
  const title = entry.path.join(" › ");
  const selectionNotice: CommandNotice[] = request.selectionTruncated ? [{ kind: "warning", title: "The selection is too large to pass on, so the command used the whole structure." }] : [];
  let structure;
  try {
    const source = await readWorkbenchSource(document, (await readWorkbenchAgentSource(document)).text);
    structure = await readMolecularStructure(source);
  } catch {
    return [{ kind: "error", title: `${title} could not read this structure.` }];
  }
  const { job, stdout } = await runner.run(entry.plugin.name, title, {
    script: entry.script, identifier: entry.command.identifier, input: commandInput(entry.command, structure, options, selectedAtoms),
  });
  if (job.status === "cancelled") return [{ kind: "info", title: `${title} was cancelled.` }];
  if (job.status !== "success" || stdout === undefined) return [{ kind: "error", title: job.error ?? `${title} failed.` }];
  let result;
  try { result = readCommandOutput(stdout, structure.atoms.length); }
  catch { return [{ kind: "error", title: `${title} answered in a form Burette cannot read.` }]; }
  const notices: CommandNotice[] = result.messages.map(message => ({
    kind: message.kind === "message" ? "info" : message.kind, title, description: message.text,
  }));
  if (result.molecule) {
    const base = document.title.replace(/\.[^.]+$/u, "") || "structure";
    const opened = await actions.openStructureRecords([{ path: `${base}-${entry.command.identifier}.${result.molecule.extension}`, inputExtension: result.molecule.extension, text: result.molecule.text }]);
    notices.push(opened.length ? { kind: "success", title: `${title} opened its result as a new document.` } : { kind: "error", title: `${title} returned a structure that could not be opened.` });
  }
  if (result.selectedAtoms.length) {
    await actions.runStructureViewerAction(document, { type: "select_residues", label: title, selector: { atom_index: result.selectedAtoms }, granularity: "atom", mode: "replace" });
    notices.push({ kind: "success", title: `${title} selected ${result.selectedAtoms.length} ${result.selectedAtoms.length === 1 ? "atom" : "atoms"}.` });
  }
  if (!notices.length) notices.push({ kind: "info", title: `${title} finished without changes.` });
  return [...selectionNotice, ...notices];
}

type MenuNode = { kind: "item"; id: string; text: string; action: () => void } | { kind: "submenu"; id: string; text: string; items: MenuNode[] };
/** Avogadro's menu placement as nested submenus, all below one "Extensions" entry. */
export function commandMenuItems(entries: readonly AvogadroCommandEntry[], onRun: (entry: AvogadroCommandEntry) => void): MenuNode[] {
  const root: MenuNode[] = [];
  for (const entry of entries) {
    let level = root, id = "avogadro";
    for (const part of entry.path.slice(0, -1)) {
      id += `/${part}`;
      let menu = level.find((node): node is Extract<MenuNode, { kind: "submenu" }> => node.kind === "submenu" && node.text === part);
      if (!menu) level.push(menu = { kind: "submenu", id, text: part, items: [] });
      level = menu.items;
    }
    level.push({ kind: "item", id: `avogadro-command-${entry.id}`, text: entry.path.at(-1)!, action: () => onRun(entry) });
  }
  return root.length ? [{ kind: "submenu", id: "avogadro-extensions", text: "Extensions", items: root }] : [];
}
