const REPO_ROOT = String(import.meta.env.BURETTE_REPO_ROOT || "");

// Vite /@fs/ needs an absolute filesystem path; remote URLs already identify their source.
export function absoluteBrowserDevPath(path: string, repoRoot = REPO_ROOT) {
  const normalized = path.replace(/\\/g, "/"), root = repoRoot.replace(/\/+$/u, "");
  return !root || normalized.startsWith("/") || /^https?:\/\//iu.test(normalized) ? normalized : `${root}/${normalized}`;
}

export function splitDevFiles(rawFiles: string) {
  return rawFiles.split("\n").map(path => path.trim()).filter(Boolean);
}

/** Only explicit server provenance bypasses local original storage. Current drafts take priority. */
export function isExplicitBrowserDevServerPath(path: string) {
  // Persisted import paths are absolute, so these cannot identify a saved browser original.
  if (!path.startsWith("/")) return true;
  if (typeof window === "undefined") return false;
  const workspace = window.BuretteMcpWorkspace;
  if (workspace?.initialPaths.includes(path) || workspace?.authorizedPaths?.includes(path)) return true;
  const params = new URLSearchParams(window.location.search);
  for (const key of ["devFiles", "quickLookFile", "devDocking"]) {
    if (params.getAll(key).flatMap(splitDevFiles).some(value => absoluteBrowserDevPath(value) === path)) return true;
  }
  return params.getAll("devFolder").map(value => value.trim()).filter(Boolean).slice(0, 16).some(value => {
    const root = absoluteBrowserDevPath(value).replace(/\/+$/u, "");
    return root !== "" && (path === root || path.startsWith(`${root}/`));
  });
}

export function hasExplicitBrowserDevServerWorkspace() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(window.BuretteMcpWorkspace) || ["devFiles", "devFolder", "quickLookFile", "devDocking"].some(key => params.has(key));
}
