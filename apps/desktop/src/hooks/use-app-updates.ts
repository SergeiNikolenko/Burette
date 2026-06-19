import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";

import type { BuildInfo } from "../components/types";
import { isTauriRuntime } from "../lib/tauri";
import {
  checkForUpdates as requestUpdateCheck,
  clearDismissedUpdate,
  dismissUpdate,
  loadUpdatePreferences,
  markAutomaticCheck,
  releasePageUrl,
  saveUpdatePreferences,
  shouldCheckAutomatically,
  shouldPromptForUpdate,
  type UpdatePreferences,
  type UpdateRelease,
  type UpdateState,
} from "../update";
import { useAppBootstrap } from "./use-app-bootstrap";

type UseAppUpdatesArgs = {
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
  pushStatus: (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
};

export function useAppUpdates({ pushErrorStatus, pushStatus }: UseAppUpdatesArgs) {
  const [update, setUpdate] = useState<UpdateState>(() => ({
    preferences: loadUpdatePreferences(),
    isChecking: false,
    isInstalling: false,
    statusText: "No update check has run yet.",
    availableRelease: null,
  }));
  const { buildInfo, buildInfoLoaded } = useAppBootstrap(setUpdate);

  const setUpdatePreferences = useCallback((preferences: UpdatePreferences) => {
    saveUpdatePreferences(preferences);
    setUpdate((previous) => ({
      ...previous,
      preferences,
      availableRelease: preferences.channel === previous.preferences.channel ? previous.availableRelease : null,
      statusText: preferences.channel === previous.preferences.channel ? previous.statusText : "Update channel changed. Check for updates again.",
    }));
  }, []);

  const installUpdate = useCallback(async (releaseOverride?: UpdateRelease | null) => {
    const release = releaseOverride ?? update.availableRelease;
    if (!release) return;
    if (!release.installAsset) {
      const url = releasePageUrl(release);
      if (isTauriRuntime()) {
        await invoke("open_external_url", { url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      pushStatus("Opened release page");
      return;
    }

    if (!isTauriRuntime()) {
      window.open(release.htmlUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setUpdate((previous) => ({
      ...previous,
      isInstalling: true,
      statusText: "Installing " + release.displayName + "... Burrete will restart when the update is ready.",
    }));
    pushStatus("Installing update...");
    try {
      clearDismissedUpdate();
      await invoke("install_update", {
        request: {
          tagName: release.tagName,
          assetName: release.installAsset.name,
          browserDownloadUrl: release.installAsset.browserDownloadUrl,
          size: release.installAsset.size,
          sha256AssetName: release.installAsset.sha256AssetName,
          sha256BrowserDownloadUrl: release.installAsset.sha256BrowserDownloadUrl,
          sha256Size: release.installAsset.sha256Size,
          manifestAssetName: release.installAsset.manifestAssetName,
          manifestBrowserDownloadUrl: release.installAsset.manifestBrowserDownloadUrl,
          manifestSize: release.installAsset.manifestSize,
          manifestSignatureAssetName: release.installAsset.manifestSignatureAssetName,
          manifestSignatureBrowserDownloadUrl: release.installAsset.manifestSignatureBrowserDownloadUrl,
          manifestSignatureSize: release.installAsset.manifestSignatureSize,
          allowSameVersion: release.replacesCurrentBuild,
        },
      });
    } catch (error) {
      setUpdate((previous) => ({
        ...previous,
        isInstalling: false,
        statusText: "Update install failed: " + (error instanceof Error ? error.message : String(error)),
      }));
      pushErrorStatus(error, "Update install failed");
    }
  }, [pushErrorStatus, pushStatus, update.availableRelease]);

  const promptForUpdate = useCallback(async (release: UpdateRelease, automatic: boolean) => {
    if (!shouldPromptForUpdate(release, automatic)) return;
    const canInstall = release.installAsset !== null;
    const message = canInstall
      ? "Burrete " + release.tagName + " is available. Install it now and restart Burrete when the update is ready?"
      : "Burrete " + release.tagName + " is available, but this release does not include an installable app archive.";
    const accepted = isTauriRuntime()
      ? await ask(message, {
        title: "Update Available",
        kind: "info",
        okLabel: canInstall ? "Install and Restart" : "Open Release Page",
        cancelLabel: "Later",
      })
      : window.confirm(message);
    if (accepted) {
      await installUpdate(release);
    } else {
      dismissUpdate(release);
    }
  }, [installUpdate]);

  const checkForUpdates = useCallback(async (automatic = false, channelOverride?: UpdatePreferences["channel"]) => {
    if (!buildInfoLoaded) {
      if (!automatic) pushStatus("Update checks are not ready yet.");
      return;
    }
    if (buildInfo.isDevBuild) {
      setUpdate((previous) => ({
        ...previous,
        isChecking: false,
        availableRelease: null,
        statusText: "Updates are disabled for dev builds.",
      }));
      if (!automatic) pushStatus("Updates are disabled for dev builds.");
      return;
    }
    const channel = channelOverride ?? update.preferences.channel;
    setUpdate((previous) => ({
      ...previous,
      isChecking: true,
      statusText: automatic ? previous.statusText : "Checking GitHub releases...",
    }));
    try {
      const release = await requestUpdateCheck(channel);
      setUpdate((previous) => ({
        ...previous,
        isChecking: false,
        availableRelease: release,
        statusText: release
          ? "Update available: " + release.displayName + " (" + release.tagName + ")." + (release.installAsset ? "" : " No downloadable app archive is attached to this release.")
          : "Burrete is up to date on " + channel + ".",
      }));
      if (release) {
        await promptForUpdate(release, automatic);
      } else {
        clearDismissedUpdate();
      }
      if (automatic) markAutomaticCheck(true);
    } catch (error) {
      setUpdate((previous) => ({
        ...previous,
        isChecking: false,
        statusText: "Update check failed: " + (error instanceof Error ? error.message : String(error)),
      }));
      if (automatic) markAutomaticCheck(false);
      if (!automatic) pushErrorStatus(error, "Update check failed");
    }
  }, [buildInfo.isDevBuild, buildInfoLoaded, promptForUpdate, pushErrorStatus, pushStatus, update.preferences.channel]);

  const openUpdateRelease = useCallback(async () => {
    try {
      const url = releasePageUrl(update.availableRelease);
      if (isTauriRuntime()) {
        await invoke("open_external_url", { url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      pushStatus("Opened release page");
    } catch (error) {
      pushErrorStatus(error, "Open release page failed");
    }
  }, [pushErrorStatus, pushStatus, update.availableRelease]);

  useEffect(() => {
    if (!buildInfoLoaded || buildInfo.isDevBuild) return undefined;
    const loadedPreferences = loadUpdatePreferences();
    if (!shouldCheckAutomatically(loadedPreferences)) return undefined;
    const timeout = window.setTimeout(() => {
      void checkForUpdates(true, loadedPreferences.channel);
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [buildInfo.isDevBuild, buildInfoLoaded, checkForUpdates]);

  return {
    buildInfo: buildInfo as BuildInfo,
    checkForUpdates,
    installUpdate,
    openUpdateRelease,
    setUpdatePreferences,
    update,
  };
}
