/**
 * The Avogadro plugin index (`plugins2.json`) is untrusted display metadata.
 * Entries are validated one by one; a malformed entry is dropped rather than
 * failing the whole catalog. Nothing here downloads or runs a plugin.
 */
export const AVOGADRO_PLUGIN_INDEX_URL = "https://avogadro.cc/plugins2.json";
export const MAX_PLUGIN_INDEX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 512;

export type AvogadroFeatureType = "menu-commands" | "file-formats" | "input-generators" | "energy-models" | "electrostatic-models";
export const FEATURE_LABELS: Record<AvogadroFeatureType, string> = {
  "menu-commands": "Commands",
  "file-formats": "File formats",
  "input-generators": "Input generators",
  "energy-models": "Energy models",
  "electrostatic-models": "Charge models",
};

export type AvogadroPlugin = {
  name: string;
  version: string;
  description?: string;
  authors: string[];
  license: string;
  features: AvogadroFeatureType[];
  /** Only `pypkg` packages with pyproject metadata are installable by the desktop runner. */
  packageKind: "python-package" | "other";
  repository: string;
  commit: string;
  archive: { url: string; sha256: string };
  readmeUrl?: string;
  issuesUrl?: string;
  updatedAt?: string;
};
export type AvogadroPluginIndex = { plugins: AvogadroPlugin[]; skipped: number };

const CONTROL = /[\p{Cc}\p{Cf}]/u;
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length && trimmed.length <= max && !CONTROL.test(trimmed) ? trimmed : undefined;
}
function httpsUrl(value: unknown, hosts?: readonly string[]): string | undefined {
  const raw = text(value, 512);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || (hosts && !hosts.includes(url.hostname))) return undefined;
    return url.href;
  } catch { return undefined; }
}
const FEATURES = new Set(Object.keys(FEATURE_LABELS));

/** Returns undefined for entries that cannot be shown truthfully. */
export function checkedAvogadroPlugin(value: unknown): AvogadroPlugin | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const git = entry.git as Record<string, unknown> | undefined, src = entry.src as Record<string, unknown> | undefined;
  const name = text(entry.name, 64), version = text(entry.version, 64), license = text(entry.license, 128);
  const commit = text(git?.commit, 40), sha256 = text(src?.sha256, 64);
  const repository = httpsUrl(git?.repo, ["github.com", "gitlab.com", "codeberg.org"])?.replace(/\.git$/u, "");
  const archive = httpsUrl(src?.url, ["plugins.avogadro.cc"]);
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/u.test(name) || !version || !/^[0-9A-Za-z.+_-]+$/u.test(version) || !license
    || !commit || !/^[0-9a-f]{40}$/u.test(commit) || !sha256 || !/^[0-9a-f]{64}$/u.test(sha256) || !repository || !archive
    || !Array.isArray(entry.authors) || entry.authors.length > 64 || !Array.isArray(entry["feature-types"]) || entry["feature-types"].length > 16) return undefined;
  const authors = entry.authors.map(author => text(author, 128));
  if (authors.some(author => !author)) return undefined;
  const features = (entry["feature-types"] as unknown[]).filter((type): type is AvogadroFeatureType => typeof type === "string" && FEATURES.has(type));
  const updated = text(entry["commit-timestamp"], 40);
  if (entry.description !== undefined && entry.description !== "" && !text(entry.description, 500)) return undefined;
  return {
    name, version, description: text(entry.description, 500), license, authors: authors as string[], features: [...new Set(features)],
    packageKind: entry["plugin-type"] === "pypkg" && entry.metadata === "pyproject.toml" ? "python-package" : "other",
    repository, commit, archive: { url: archive, sha256 },
    readmeUrl: httpsUrl(entry["readme-url"]), issuesUrl: httpsUrl(entry["bug-tracker"]),
    updatedAt: updated && !Number.isNaN(Date.parse(updated)) ? new Date(updated).toISOString() : undefined,
  };
}

export function parseAvogadroPluginIndex(document: unknown): AvogadroPluginIndex {
  if (!Array.isArray(document) || document.length > MAX_ENTRIES) throw new Error("The plugin index is not a list of plugins.");
  const plugins: AvogadroPlugin[] = [], seen = new Set<string>();
  let skipped = 0;
  for (const value of document) {
    const plugin = checkedAvogadroPlugin(value);
    if (!plugin || seen.has(plugin.name)) { skipped++; continue; }
    seen.add(plugin.name); plugins.push(plugin);
  }
  plugins.sort((left, right) => left.name.localeCompare(right.name, "en"));
  return { plugins, skipped };
}

/** Reads at most {@link MAX_PLUGIN_INDEX_BYTES} from a streamed response. */
export async function readBoundedText(response: Response, signal?: AbortSignal): Promise<string> {
  if (!response.ok || !response.body) throw new Error("The plugin index could not be downloaded.");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_PLUGIN_INDEX_BYTES) throw new Error("The plugin index is larger than Burette accepts.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PLUGIN_INDEX_BYTES) throw new Error("The plugin index is larger than Burette accepts.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export type AvogadroPluginLink = "source" | "readme" | "issues" | "download";
export function pluginLinkUrl(plugin: AvogadroPlugin, link: AvogadroPluginLink): string | undefined {
  return link === "source" ? plugin.repository : link === "readme" ? plugin.readmeUrl : link === "issues" ? plugin.issuesUrl : plugin.archive.url;
}
