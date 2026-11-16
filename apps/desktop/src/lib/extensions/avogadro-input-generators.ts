/**
 * Avogadro input-generator plugins (`[[tool.avogadro.input-generators]]`), as
 * avogadrolibs runs them in package mode at the pinned revision: `<script>
 * <identifier> --lang en`, with no operation flag, reads `{ options, cjson,
 * charge, spin, selectedAtoms }` and prints `{ files, mainFile, warnings }`.
 * Burette then fills the files' `$$…$$` keywords with its own coordinate blocks
 * (keyword rules adapted from avogadrolibs cb0e9485 `interfacescript.cpp`,
 * BSD-3-Clause; see THIRD_PARTY_NOTICES.md).
 */
import { useMemo, useSyncExternalStore } from "react";
import { writeCjson } from "../molecular-workbench/cjson-graph";
import { generateCoordinateBlock } from "../molecular-workbench/coordinate-block";
import type { MolecularAtom, MolecularBond, UnitCell } from "../molecular-workbench/types";
import type { CommandOptionValue } from "./avogadro-command-io";
import { readPluginManifest, type PluginInputGenerator } from "./avogadro-plugin-manifest";
import { isTauriRuntime } from "../tauri";
import { avogadroPluginRunner, type InstalledAvogadroPlugin } from "./avogadro-plugin-runner";

export type AvogadroGeneratorEntry = { id: string; plugin: InstalledAvogadroPlugin; script: string; generator: PluginInputGenerator };
export type GeneratedInput = { files: { name: string; text: string }[]; mainFile: string; warnings: string[] };
type Molecule = { atoms: readonly MolecularAtom[]; bonds: readonly MolecularBond[]; cell?: UnitCell | null };

/** Input generators of prepared plugins, in package and declaration order. */
export function availableGenerators(installed: readonly InstalledAvogadroPlugin[]): AvogadroGeneratorEntry[] {
  return installed.filter(plugin => plugin.prepared).flatMap(plugin => {
    const manifest = readPluginManifest(plugin.pyproject);
    return manifest?.script ? manifest.generators.map(generator => ({ id: `${plugin.name}:${generator.identifier}`, plugin, script: manifest.script!, generator })) : [];
  });
}

const noInstalled: readonly InstalledAvogadroPlugin[] = [];
const subscribeNothing = () => () => {};
/** Desktop only: plugins run through the native shell. */
export function useAvogadroGenerators(): AvogadroGeneratorEntry[] {
  const runner = isTauriRuntime() ? avogadroPluginRunner() : undefined;
  const installed = useSyncExternalStore(runner?.subscribe ?? subscribeNothing, () => runner?.getSnapshot().installed ?? noInstalled, () => noInstalled);
  return useMemo(() => availableGenerators(installed), [installed]);
}

/** The stdin document for one generator run; the molecule is always CJSON. */
export function generatorInput({ atoms, bonds, cell }: Molecule, options: Record<string, CommandOptionValue>, { charge = 0, spin = 1 } = {}) {
  return JSON.stringify({ options, cjson: writeCjson({ atoms, bonds, cell }), charge, spin, selectedAtoms: [] });
}

// The value names Avogadro's z-matrix entry of a "Coordinates" option; spelling is a convention scripts follow by hand.
const wantsZmatrix = (value: CommandOptionValue | undefined) => typeof value === "string" && /z-matrix|zmatrix|zmat|internal/u.test(value.toLowerCase());
const KEYWORD = /\$\$(coords|zmat|zmatpad):([^$]*)\$\$/gu;

/** Removes the keyword, and its line when the keyword is all the line holds. */
function removeKeywordLine(text: string, keyword: string) {
  let index = text.indexOf(keyword);
  while (index >= 0) {
    let start = index, end = index + keyword.length;
    const lineStart = text.lastIndexOf("\n", index) + 1, found = text.indexOf("\n", end), lineEnd = found < 0 ? text.length : found;
    if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) { start = lineStart; end = lineEnd < text.length ? lineEnd + 1 : lineEnd; }
    text = text.slice(0, start) + text.slice(end);
    index = text.indexOf(keyword, start);
  }
  return text;
}

/**
 * Avogadro's `replaceKeywords`: atom and bond counts, then each coordinate block.
 * A file offering both a Cartesian and a Z-matrix block keeps the one its
 * "Coordinates" option selects and drops the other's line; a file offering one
 * form always gets it.
 */
export function replaceKeywords(text: string, { atoms, bonds }: Molecule, options: Record<string, CommandOptionValue>) {
  text = text.replaceAll("$$atomCount$$", String(atoms.length)).replaceAll("$$bondCount$$", String(bonds.length));
  const kinds = new Set([...text.matchAll(KEYWORD)].map(match => match[1] === "coords" ? "cartesian" : "zmatrix"));
  const choosing = kinds.size === 2, zmatrix = wantsZmatrix(options.Coordinates);
  for (const [keyword, name, spec] of [...new Map([...text.matchAll(KEYWORD)].map(match => [match[0], match])).values()]) {
    const isZmatrix = name !== "coords";
    if (choosing && isZmatrix !== zmatrix) { text = removeKeywordLine(text, keyword); continue; }
    const block = generateCoordinateBlock(atoms, { spec, mode: name === "coords" ? "cartesian" : name === "zmat" ? "zmatrix" : "zmatrix-padded", unit: "angstrom" });
    text = text.replaceAll(keyword, block.replace(/\n$/u, ""));
  }
  return text;
}

const MAX_FILES = 16;
const fileName = (value: unknown) => typeof value === "string" && value.length <= 128 && /^[^/\\\p{Cc}]+$/u.test(value) && !/^\.+$/u.test(value) ? value : undefined;

/** Parses the script's answer; leading non-JSON lines (library chatter) are ignored. Files given only by `filePath` are refused. */
export function readGeneratorOutput(stdout: string, molecule: Molecule, options: Record<string, CommandOptionValue>): GeneratedInput {
  const start = stdout.search(/^\s*\{/mu);
  if (start < 0) throw new Error("The generator did not answer with JSON.");
  const document = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
  if (!document || typeof document !== "object" || !Array.isArray(document.files) || !document.files.length) throw new Error("The generator returned no files.");
  const files = document.files.slice(0, MAX_FILES).map(entry => {
    const file = entry as Record<string, unknown>, name = fileName(file?.filename);
    if (!name || typeof file.contents !== "string") throw new Error("The generator returned a file Burette cannot read.");
    return { name, text: replaceKeywords(file.contents, molecule, options) };
  });
  const mainFile = typeof document.mainFile === "string" && files.some(file => file.name === document.mainFile) ? document.mainFile : files[0].name;
  const warnings = Array.isArray(document.warnings) ? document.warnings.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map(value => value.trim().slice(0, 500)).slice(0, 20) : [];
  return { files, mainFile, warnings };
}
