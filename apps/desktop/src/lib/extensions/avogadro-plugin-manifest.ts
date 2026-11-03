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
export type PluginManifest = {
  name: string;
  version?: string;
  /** The `avogadro-*` console script that implements the package's features. */
  script?: string;
  commands: PluginCommand[];
  /** Counts of declared feature tables other than menu commands. */
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

function key(text: string): string[] | undefined {
  const parts = text.split(".").map(part => part.trim().replace(/^"(.*)"$/u, "$1"));
  return parts.every(part => /^[A-Za-z0-9_-]+$/u.test(part)) ? parts : undefined;
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
    const assignment = /^([A-Za-z0-9_."-]+)\s*=\s*/u.exec(line);
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
  const otherFeatures: Record<string, number> = {};
  for (const [feature, entries] of Object.entries(tool ?? {})) {
    if (feature !== "menu-commands" && Array.isArray(entries) && entries.length) otherFeatures[feature] = entries.length;
  }
  return { name, version: text(project?.version, 64), script: scripts.length === 1 ? scripts[0] : scripts.find(script => script === name), commands, otherFeatures };
}
