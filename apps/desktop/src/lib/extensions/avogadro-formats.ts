/**
 * Avogadro file-format plugins (`[[tool.avogadro.file-formats]]`): `<script>
 * <identifier> --read` gets the file on stdin (or, in file mode, a JSON object
 * naming its path) and prints the molecule in the declared output format. The
 * result opens as a new document next to the file.
 */
import type { ShellActions } from "../../components/types";
import { readStructureText } from "../structure-text";
import { readPluginManifest, type PluginFileFormat } from "./avogadro-plugin-manifest";
import { avogadroPluginRunner, type InstalledAvogadroPlugin } from "./avogadro-plugin-runner";

export type AvogadroFormatEntry = { id: string; plugin: InstalledAvogadroPlugin; script: string; format: PluginFileFormat };
type Runner = ReturnType<typeof avogadroPluginRunner>;

/** Readers of prepared plugins, in package and declaration order. */
export function availableFormats(installed: readonly InstalledAvogadroPlugin[]): AvogadroFormatEntry[] {
  return installed.filter(plugin => plugin.prepared).flatMap(plugin => {
    const manifest = readPluginManifest(plugin.pyproject);
    return manifest?.script ? manifest.formats.map(format => ({ id: `${plugin.name}:${format.identifier}`, plugin, script: manifest.script!, format })) : [];
  });
}

const extensionOf = (path: string) => /\.([^./\\]+)$/u.exec(path)?.[1]?.toLowerCase();
export const formatsForPath = (entries: readonly AvogadroFormatEntry[], path: string) => {
  const extension = extensionOf(path);
  return extension ? entries.filter(entry => entry.format.extensions.includes(extension)) : [];
};

/** Reads `path` with the plugin and opens the molecule it prints; throws a user-facing message on failure. */
export async function openWithAvogadroFormat(entry: AvogadroFormatEntry, path: string, actions: Pick<ShellActions, "openStructureRecords">,
  { runner = avogadroPluginRunner(), readText = readStructureText }: { runner?: Runner; readText?: (path: string) => Promise<string> } = {}) {
  const name = path.split(/[\\/]/u).at(-1) ?? path, title = `Open ${name} with ${entry.format.name}`;
  const input = entry.format.inputMode === "file" ? JSON.stringify({ operation: "read", filename: path }) : await readText(path);
  const { job, stdout } = await runner.run(entry.plugin.name, title, { script: entry.script, identifier: entry.format.identifier, operation: "read", input });
  if (job.status === "cancelled") return [];
  if (job.status !== "success" || !stdout?.trim()) throw new Error(`${entry.format.name} could not read ${name}.`);
  // cclib prints its logging before the document, as Avogadro tolerates.
  const text = entry.format.outputFormat === "cjson" ? stdout.slice(Math.max(0, stdout.search(/^\s*\{/mu))) : stdout;
  const extension = entry.format.outputFormat === "mol" ? "sdf" : entry.format.outputFormat;
  const opened = await actions.openStructureRecords([{ path: `${name.replace(/\.[^.]+$/u, "") || "structure"}.${extension}`, inputExtension: extension, text }]);
  if (!opened.length) throw new Error(`${entry.format.name} returned a structure that could not be opened.`);
  return opened;
}
