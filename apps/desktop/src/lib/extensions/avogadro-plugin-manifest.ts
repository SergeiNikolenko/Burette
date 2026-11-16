/**
 * Reads what an installed Avogadro package declares in its `pyproject.toml`:
 * the console script and the `[tool.avogadro]` feature tables.
 *
 * This is a reader for the TOML subset these manifests use (tables, arrays of
 * tables, strings, numbers, booleans and arrays). Values it does not understand
 * are skipped, never guessed.
 */
export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
type Table = { [key: string]: TomlValue };

export type PluginCommand = {
  identifier: string;
  label: string;
  menuPath: string[];
  inputFormat: "sdf" | "cjson" | "xyz" | "mol" | "pdb";
  inputCjson: boolean;
  userOptions?: string;
};
/** A `[[tool.avogadro.file-formats]]` reader: the file in, a molecule in `outputFormat` out. */
export type PluginFileFormat = {
  identifier: string;
  name: string;
  /** Lower-case extensions without the dot. */
  extensions: string[];
  outputFormat: "cjson" | "xyz" | "sdf" | "mol" | "pdb";
  /** `file`: the script is sent the path and reads the file itself. */
  inputMode: "string" | "file";
};
/** A `[[tool.avogadro.input-generators]]` program: options and a molecule in, input files out. */
export type PluginInputGenerator = {
  identifier: string;
  programName: string;
  inputFormat: PluginCommand["inputFormat"];
  periodic: boolean;
  userOptions?: string;
};
export type PluginManifest = {
  name: string;
  version?: string;
  /** The `avogadro-*` console script that implements the package's features. */
  script?: string;
  commands: PluginCommand[];
  formats: PluginFileFormat[];
  generators: PluginInputGenerator[];
  /** Counts of declared feature tables Burette does not run. */
  otherFeatures: Record<string, number>;
};

const MAX_MANIFEST_BYTES = 64 * 1024;

function stringValue(source: string, start: number): [string, number] | undefined {
  const quote = source[start];
  let index = start + 1, out = "";
  while (index < source.length) {
    const character = source[index];
    if (character === quote) return [out, index + 1];
    if (character === "\n") return undefined;
    if (quote === '"' && character === "\\") {
      const next = source[index + 1];
      const simple: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
      if (next in simple) { out += simple[next]; index += 2; continue; }
      if (next === "u" && /^[0-9a-fA-F]{4}$/u.test(source.slice(index + 2, index + 6))) {
        out += String.fromCharCode(parseInt(source.slice(index + 2, index + 6), 16)); index += 6; continue;
      }
      return undefined;
    }
    out += character; index++;
  }
  return undefined;
}

function skipBlank(source: string, index: number): number {
  for (;;) {
    while (index < source.length && /\s/u.test(source[index])) index++;
    if (source[index] !== "#") return index;
    while (index < source.length && source[index] !== "\n") index++;
  }
}

/** Parses one value at `start`; returns undefined for unsupported syntax. */
function value(source: string, start: number, depth = 0): [TomlValue, number] | undefined {
  if (depth > 8) return undefined;
  const character = source[start];
  if (character === '"' || character === "'") {
    if (source.startsWith(character.repeat(3), start)) return undefined;
    return stringValue(source, start);
  }
  if (character === "[" || character === "{") {
    const inline = character === "{", items: TomlValue[] = [], table: Table = {};
    let index = skipBlank(source, start + 1);
    while (source[index] !== (inline ? "}" : "]")) {
      let name: string | undefined;
      if (inline) {
        name = /^[A-Za-z0-9_-]+/u.exec(source.slice(index))?.[0];
        if (!name) return undefined;
        index = skipBlank(source, index + name.length);
        if (source[index] !== "=") return undefined;
        index = skipBlank(source, index + 1);
      }
      const parsed = value(source, index, depth + 1);
      if (!parsed) return undefined;
      if (name) table[name] = parsed[0];
      else items.push(parsed[0]);
      index = skipBlank(source, parsed[1]);
      if (source[index] === ",") index = skipBlank(source, index + 1);
      else if (source[index] !== (inline ? "}" : "]")) return undefined;
    }
    return [inline ? table : items, index + 1];
  }
  const token = /^[^\s,\]}#]+/u.exec(source.slice(start))?.[0];
  if (!token) return undefined;
  if (token === "true" || token === "false") return [token === "true", start + token.length];
  if (/^[+-]?\d[\d_]*(\.\d+)?$/u.test(token)) return [Number(token.replaceAll("_", "")), start + token.length];
  return undefined;
}

// Quoted parts may hold spaces (`["Filename Base"]` in an options file) but no dots or quotes.
function key(text: string): string[] | undefined {
  const parts = text.split(".").map(part => part.trim());
  return parts.every(part => /^[A-Za-z0-9_-]+$/u.test(part) || /^"[^"\\\p{Cc}]{1,128}"$/u.test(part)) ? parts.map(part => part.replace(/^"(.*)"$/u, "$1")) : undefined;
}

export function parseToml(source: string): Table {
  const root: Table = {};
  let current: Table | undefined = root;
  let index = 0;
  const descend = (path: string[], table: Table) => {
    let node = table;
    for (const part of path) {
      const next = node[part];
      if (Array.isArray(next)) node = next.at(-1) as Table;
      else if (next && typeof next === "object") node = next;
      else if (next === undefined) node = (node[part] = {}) as Table;
      else return undefined;
    }
    return node;
  };
  while ((index = skipBlank(source, index)) < source.length) {
    const end = source.indexOf("\n", index), line = source.slice(index, end < 0 ? source.length : end);
    const array = /^\[\[([^\]]+)\]\]\s*(#.*)?$/u.exec(line), table = /^\[([^\]]+)\]\s*(#.*)?$/u.exec(line);
    if (array || table) {
      const path = key((array ?? table)![1]);
      if (!path) { current = undefined; index += line.length; continue; }
      if (array) {
        const parent = descend(path.slice(0, -1), root), last = path.at(-1)!;
        const list = parent?.[last];
        if (parent && (list === undefined || Array.isArray(list))) {
          const entry: Table = {};
          parent[last] = [...(list as TomlValue[] | undefined ?? []), entry];
          current = entry;
        } else current = undefined;
      } else current = descend(path, root);
      index += line.length;
      continue;
    }
    const assignment = /^([A-Za-z0-9_.-]+|"[^"\n]+")\s*=\s*/u.exec(line);
    const parsed = assignment ? value(source, index + assignment[0].length) : undefined;
    const path = assignment ? key(assignment[1]) : undefined;
    if (assignment && parsed && path && current) {
      const target = descend(path.slice(0, -1), current);
      if (target && !(path.at(-1)! in target)) target[path.at(-1)!] = parsed[0];
      index = parsed[1];
    } else index += Math.max(line.length, 1);
  }
  return root;
}

const text = (input: TomlValue | undefined, max = 128) =>
  typeof input === "string" && input.trim() && input.length <= max && !/[\p{Cc}\p{Cf}]/u.test(input) ? input.trim() : undefined;
const FORMATS = new Set(["sdf", "cjson", "xyz", "mol", "pdb"]);

export function readPluginManifest(pyproject: string): PluginManifest | undefined {
  if (pyproject.length > MAX_MANIFEST_BYTES) return undefined;
  const document = parseToml(pyproject);
  const project = document.project as Table | undefined, tool = (document.tool as Table | undefined)?.avogadro as Table | undefined;
  const name = text(project?.name);
  if (!name) return undefined;
  const scripts = Object.entries((project?.scripts as Table | undefined) ?? {})
    .map(([script]) => script).filter(script => /^avogadro-[a-z0-9_-]+$/u.test(script) && !script.endsWith("-setup"));
  const commands: PluginCommand[] = [];
  for (const entry of Array.isArray(tool?.["menu-commands"]) ? tool["menu-commands"] as Table[] : []) {
    const identifier = text(entry.identifier, 64), label = text(entry.item);
    const format = text(entry["input-format"], 16)?.toLowerCase() ?? "cjson";
    if (!identifier || !/^[A-Za-z0-9_.-]+$/u.test(identifier) || !label || !FORMATS.has(format)) continue;
    if (commands.some(command => command.identifier === identifier)) continue;
    const menuPath = [text(entry.menu), text(entry.submenu)].filter((part): part is string => Boolean(part));
    const userOptions = text(entry["user-options"], 256);
    commands.push({ identifier, label: label.replace(/…$|\.\.\.$/u, ""), menuPath, inputFormat: format as PluginCommand["inputFormat"],
      inputCjson: entry["input-cjson"] === true, ...(userOptions ? { userOptions } : {}) });
  }
  const tables = (feature: string) => Array.isArray(tool?.[feature]) ? tool[feature] as Table[] : [];
  const identifierOf = (entry: Table) => { const value = text(entry.identifier, 64); return value && /^[A-Za-z0-9_.-]+$/u.test(value) ? value : undefined; };
  const formats: PluginFileFormat[] = [];
  for (const entry of tables("file-formats")) {
    const identifier = identifierOf(entry), name = text(entry["format-name"]), output = text(entry["output-format"], 16)?.toLowerCase();
    const extensions = (Array.isArray(entry["file-extensions"]) ? entry["file-extensions"] : []).map(value => text(value, 16)?.toLowerCase().replace(/^\./u, ""))
      .filter((value): value is string => Boolean(value && /^[a-z0-9_+-]+$/u.test(value)));
    // Only readers: Burette writes its own formats.
    if (!identifier || !name || (entry.support as Table | undefined)?.read !== true || !output || !FORMATS.has(output) || !extensions.length) continue;
    formats.push({ identifier, name, extensions: [...new Set(extensions)].slice(0, 32), outputFormat: output as PluginFileFormat["outputFormat"],
      inputMode: text(entry["input-mode"], 16)?.toLowerCase() === "file" ? "file" : "string" });
  }
  const generators: PluginInputGenerator[] = [];
  for (const entry of tables("input-generators")) {
    const identifier = identifierOf(entry), programName = text(entry["program-name"]), format = text(entry["input-format"], 16)?.toLowerCase() ?? "cjson";
    const support = entry.support as Table | undefined, userOptions = text(entry["user-options"], 256);
    if (!identifier || !programName || !FORMATS.has(format) || support?.molecular === false || generators.some(generator => generator.identifier === identifier)) continue;
    generators.push({ identifier, programName, inputFormat: format as PluginCommand["inputFormat"], periodic: support?.periodic === true, ...(userOptions ? { userOptions } : {}) });
  }
  const otherFeatures: Record<string, number> = {};
  for (const [feature, entries] of Object.entries(tool ?? {})) {
    if (!["menu-commands", "file-formats", "input-generators"].includes(feature) && Array.isArray(entries) && entries.length) otherFeatures[feature] = entries.length;
  }
  return { name, version: text(project?.version, 64), script: scripts.length === 1 ? scripts[0] : scripts.find(script => script === name), commands, formats, generators, otherFeatures };
}
