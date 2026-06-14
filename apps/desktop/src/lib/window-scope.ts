type WorkspaceStorageKeyOptions = {
  windowScoped?: boolean;
};

function currentWindowStorageSuffix() {
  if (typeof window === "undefined" || !window.location) return "";
  const windowLabel = new URLSearchParams(window.location.search).get("burreteWindow")?.trim() ?? "";
  if (!windowLabel || windowLabel === "main") return "";
  return `.${windowLabel.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function workspaceStorageKey(baseKey: string, options: WorkspaceStorageKeyOptions = {}) {
  if (options.windowScoped === false) return baseKey;
  return `${baseKey}${currentWindowStorageSuffix()}`;
}
