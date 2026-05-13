import { useEffect } from "react";

export function useAutoRefresh(
  path: string | null,
  shouldRefresh: boolean,
  refreshDirectory: (path: string) => Promise<void>,
) {
  useEffect(() => {
    if (!path || !shouldRefresh) return;
    void refreshDirectory(path);
  }, [path, refreshDirectory, shouldRefresh]);
}
