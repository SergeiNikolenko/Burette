import packageInfo from "../../../../package.json";
import type { BuildInfo } from "../components/types";
import { isTauriRuntime } from "./tauri";

const RELEASE_IDENTIFIER = "com.local.BurreteV10";
const buildIdentifier = import.meta.env.VITE_BURRETE_BUILD_IDENTIFIER;
const buildFlavor = import.meta.env.VITE_BURRETE_BUILD_FLAVOR;
const buildChannel = import.meta.env.VITE_BURRETE_BUILD_CHANNEL;

function devFlavorFromIdentifier(identifier: string) {
  return identifier.match(/\.Dev\.([A-Za-z][A-Za-z0-9-]*)$/u)?.[1] ?? null;
}

function buildInfoFromValues(
  name: string,
  version: string,
  identifier: string,
  isBrowserDev = false,
  explicitFlavor?: string,
): BuildInfo {
  const flavor = explicitFlavor || devFlavorFromIdentifier(identifier);
  const isDevBuild = Boolean(flavor) || buildChannel === "dev" || isBrowserDev;
  return {
    name,
    version,
    identifier,
    flavor: isBrowserDev ? "browser" : flavor,
    isDevBuild,
    isBrowserDev,
    notes: isDevBuild
      ? ["Full desktop features", isBrowserDev ? "Vite browser runtime" : "Isolated app and Quick Look identifiers"]
      : [],
    limitations: isBrowserDev
      ? ["Native app bundle, installer, and Quick Look registration are not active in browser dev."]
      : [],
  };
}

export const defaultBuildInfo = buildInfoFromValues(
  "Burrete",
  packageInfo.version,
  buildIdentifier ?? (import.meta.env.DEV ? "browser-dev" : RELEASE_IDENTIFIER),
  import.meta.env.DEV,
  buildFlavor,
);

export async function loadBuildInfo(): Promise<BuildInfo> {
  if (!isTauriRuntime()) return defaultBuildInfo;
  try {
    const [{ getIdentifier, getName, getVersion }] = await Promise.all([
      import("@tauri-apps/api/app"),
    ]);
    return buildInfoFromValues(
      await getName(),
      await getVersion(),
      buildIdentifier ?? await getIdentifier(),
      false,
      buildFlavor,
    );
  } catch (_) {
    return defaultBuildInfo;
  }
}
