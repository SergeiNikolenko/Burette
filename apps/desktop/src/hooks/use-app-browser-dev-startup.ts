import { useMemo } from "react";
import {
  browserDevFoldersFromLocation,
  browserDevHasExplicitWorkspace,
  browserDevQuickLookFileFromLocation,
} from "../lib/browser-dev-startup";

export function useAppBrowserDevStartup() {
  const browserDevExplicitFolders = useMemo(() => browserDevFoldersFromLocation(), []);
  const browserDevHasExplicitWorkspaceQuery = useMemo(() => browserDevHasExplicitWorkspace(), []);
  const browserDevQuickLookPath = browserDevQuickLookFileFromLocation();

  return {
    browserDevExplicitFolders,
    browserDevHasExplicitWorkspaceQuery,
    browserDevQuickLookPath,
  };
}
