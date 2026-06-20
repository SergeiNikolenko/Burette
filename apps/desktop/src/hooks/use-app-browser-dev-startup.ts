import { useMemo } from "react";
import { browserDevFolderFromLocation, browserDevHasExplicitWorkspace } from "../lib/browser-dev-startup";

export function useAppBrowserDevStartup() {
  const browserDevExplicitFolder = useMemo(() => browserDevFolderFromLocation(), []);
  const browserDevHasExplicitWorkspaceQuery = useMemo(() => browserDevHasExplicitWorkspace(), []);

  return {
    browserDevExplicitFolder,
    browserDevHasExplicitWorkspaceQuery,
  };
}
