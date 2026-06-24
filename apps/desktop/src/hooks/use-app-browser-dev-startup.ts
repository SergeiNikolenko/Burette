import { useMemo } from "react";
import { browserDevFoldersFromLocation, browserDevHasExplicitWorkspace } from "../lib/browser-dev-startup";

export function useAppBrowserDevStartup() {
  const browserDevExplicitFolders = useMemo(() => browserDevFoldersFromLocation(), []);
  const browserDevHasExplicitWorkspaceQuery = useMemo(() => browserDevHasExplicitWorkspace(), []);

  return {
    browserDevExplicitFolders,
    browserDevHasExplicitWorkspaceQuery,
  };
}
