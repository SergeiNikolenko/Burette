import packageInfo from "../../../package.json";

export type UpdateChannel = "stable" | "beta";

export type UpdatePreferences = {
  checkAutomatically: boolean;
  channel: UpdateChannel;
};

export type UpdateAsset = {
  name: string;
  browserDownloadUrl: string;
  size: number;
  sha256AssetName: string;
  sha256BrowserDownloadUrl: string;
  sha256Size: number;
  manifestAssetName: string;
  manifestBrowserDownloadUrl: string;
  manifestSize: number;
  manifestSignatureAssetName: string;
  manifestSignatureBrowserDownloadUrl: string;
  manifestSignatureSize: number;
};

export type UpdateRelease = {
  tagName: string;
  displayName: string;
  htmlUrl: string;
  prerelease: boolean;
  installAsset: UpdateAsset | null;
};

export type UpdateState = {
  preferences: UpdatePreferences;
  isChecking: boolean;
  isInstalling: boolean;
  statusText: string;
  availableRelease: UpdateRelease | null;
};

type GitHubAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
};

type GitHubRelease = {
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubAsset[];
};

const RELEASES_URL = "https://api.github.com/repos/SergeiNikolenko/Burrete/releases";
const RELEASES_PAGE_URL = "https://github.com/SergeiNikolenko/Burrete/releases";
const AUTOMATIC_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const AUTOMATIC_FAILURE_RETRY_MS = 60 * 60 * 1000;
const STORAGE_PREFIX = "buret.update.";

export const CURRENT_VERSION = packageInfo.version;

export const defaultUpdatePreferences: UpdatePreferences = {
  checkAutomatically: true,
  channel: "stable",
};

export function loadUpdatePreferences(): UpdatePreferences {
  return {
    checkAutomatically: storedBoolean("checkAutomatically", defaultUpdatePreferences.checkAutomatically),
    channel: storedChannel("channel", defaultUpdatePreferences.channel),
  };
}

export function saveUpdatePreferences(preferences: UpdatePreferences) {
  try {
    localStorage.setItem(STORAGE_PREFIX + "checkAutomatically", String(preferences.checkAutomatically));
    localStorage.setItem(STORAGE_PREFIX + "channel", preferences.channel);
  } catch (_) {}
}

export function shouldCheckAutomatically(preferences: UpdatePreferences) {
  if (!preferences.checkAutomatically) return false;
  const lastSuccess = storedNumber("lastAutomaticSuccessAt", 0);
  const lastFailure = storedNumber("lastAutomaticFailureAt", 0);
  const now = Date.now();
  return now - lastSuccess >= AUTOMATIC_CHECK_INTERVAL_MS && now - lastFailure >= AUTOMATIC_FAILURE_RETRY_MS;
}

export function markAutomaticCheck(success: boolean) {
  try {
    localStorage.setItem(STORAGE_PREFIX + (success ? "lastAutomaticSuccessAt" : "lastAutomaticFailureAt"), String(Date.now()));
    if (success) localStorage.removeItem(STORAGE_PREFIX + "lastAutomaticFailureAt");
  } catch (_) {}
}

export function shouldPromptForUpdate(release: UpdateRelease, automatic: boolean) {
  if (!automatic) return true;
  try {
    return localStorage.getItem(STORAGE_PREFIX + "dismissedVersion") !== release.tagName;
  } catch (_) {
    return true;
  }
}

export function dismissUpdate(release: UpdateRelease) {
  try {
    localStorage.setItem(STORAGE_PREFIX + "dismissedVersion", release.tagName);
  } catch (_) {}
}

export function clearDismissedUpdate() {
  try {
    localStorage.removeItem(STORAGE_PREFIX + "dismissedVersion");
  } catch (_) {}
}

export async function checkForUpdates(channel: UpdateChannel): Promise<UpdateRelease | null> {
  const response = await fetch(RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    let message = "";
    try {
      const body = await response.json() as { message?: string };
      message = body.message ? ": " + body.message : "";
    } catch (_) {}
    throw new Error("GitHub returned HTTP " + response.status + message);
  }
  const releases = await response.json() as GitHubRelease[];
  return newestUpdate(releases, channel);
}

export function releasePageUrl(release: UpdateRelease | null) {
  return release?.htmlUrl || RELEASES_PAGE_URL;
}

function newestUpdate(releases: GitHubRelease[], channel: UpdateChannel): UpdateRelease | null {
  const current = parseVersion(CURRENT_VERSION);
  const candidates = releases
    .filter((release) => !release.draft)
    .filter((release) => channel === "beta" || !release.prerelease)
    .map(normalizeRelease)
    .filter((release): release is UpdateRelease => release !== null)
    .filter((release) => compareVersions(parseVersion(release.tagName), current) > 0)
    .sort((a, b) => compareVersions(parseVersion(b.tagName), parseVersion(a.tagName)));
  return candidates[0] ?? null;
}

function normalizeRelease(release: GitHubRelease): UpdateRelease | null {
  if (!release.tag_name || !release.html_url) return null;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installAsset = installAssetFor(assets);
  const displayName = (release.name || "").trim() || release.tag_name;
  return {
    tagName: release.tag_name,
    displayName,
    htmlUrl: release.html_url,
    prerelease: release.prerelease === true,
    installAsset,
  };
}

function installAssetFor(assets: GitHubAsset[]): UpdateAsset | null {
  const installExtensions = [".zip"];
  const candidates = assets
    .filter((asset) => asset.name && asset.browser_download_url && Number(asset.size || 0) > 0)
    .filter((asset) => installExtensions.some((extension) => asset.name!.toLowerCase().endsWith(extension)))
    .map((asset) => ({
      asset,
      digest: sha256AssetFor(assets, asset.name!),
      manifest: manifestAssetFor(assets, asset.name!),
      signature: manifestSignatureAssetFor(assets, asset.name!),
    }))
    .filter((entry): entry is { asset: GitHubAsset; digest: GitHubAsset; manifest: GitHubAsset; signature: GitHubAsset } =>
      entry.digest !== null && entry.manifest !== null && entry.signature !== null);
  const selected = candidates.find((entry) => /burrete|burette/i.test(entry.asset.name!)) ?? candidates[0];
  if (!selected) return null;
  return {
    name: selected.asset.name!,
    browserDownloadUrl: selected.asset.browser_download_url!,
    size: Number(selected.asset.size || 0),
    sha256AssetName: selected.digest.name!,
    sha256BrowserDownloadUrl: selected.digest.browser_download_url!,
    sha256Size: Number(selected.digest.size || 0),
    manifestAssetName: selected.manifest.name!,
    manifestBrowserDownloadUrl: selected.manifest.browser_download_url!,
    manifestSize: Number(selected.manifest.size || 0),
    manifestSignatureAssetName: selected.signature.name!,
    manifestSignatureBrowserDownloadUrl: selected.signature.browser_download_url!,
    manifestSignatureSize: Number(selected.signature.size || 0),
  };
}

function sha256AssetFor(assets: GitHubAsset[], archiveName: string): GitHubAsset | null {
  const expectedName = archiveName + ".sha256";
  return assets.find((asset) =>
    asset.name === expectedName &&
    asset.browser_download_url &&
    Number(asset.size || 0) > 0 &&
    Number(asset.size || 0) <= 4096
  ) ?? null;
}

function manifestAssetFor(assets: GitHubAsset[], archiveName: string): GitHubAsset | null {
  const expectedName = archiveName + ".manifest.json";
  return assets.find((asset) =>
    asset.name === expectedName &&
    asset.browser_download_url &&
    Number(asset.size || 0) > 0 &&
    Number(asset.size || 0) <= 16384
  ) ?? null;
}

function manifestSignatureAssetFor(assets: GitHubAsset[], archiveName: string): GitHubAsset | null {
  const expectedName = archiveName + ".manifest.json.sig";
  return assets.find((asset) =>
    asset.name === expectedName &&
    asset.browser_download_url &&
    Number(asset.size || 0) > 0 &&
    Number(asset.size || 0) <= 512
  ) ?? null;
}

function parseVersion(raw: string) {
  return raw.trim().replace(/^v/i, "").split(/[+-]/)[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left: number[], right: number[]) {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function storedBoolean(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(STORAGE_PREFIX + key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch (_) {}
  return fallback;
}

function storedChannel(key: string, fallback: UpdateChannel): UpdateChannel {
  try {
    const value = localStorage.getItem(STORAGE_PREFIX + key);
    if (value === "stable" || value === "beta") return value;
  } catch (_) {}
  return fallback;
}

function storedNumber(key: string, fallback: number) {
  try {
    const value = Number(localStorage.getItem(STORAGE_PREFIX + key));
    return Number.isFinite(value) ? value : fallback;
  } catch (_) {
    return fallback;
  }
}
