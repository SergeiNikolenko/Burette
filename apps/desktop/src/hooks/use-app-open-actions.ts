import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import previewFormatRegistry from "../../../../config/preview-formats.json";
import { isTauriRuntime } from "../lib/tauri";
import type { RecentStructure } from "../types";

const filters = [
  {
    name: "Files",
    extensions: [...previewFormatRegistry.documentTypes.extensions, "ms", "magma", "mgf", "msp", "mzML", "mzXML", "md", "markdown", "mdx", "txt", "log", "out", "err", "sh", "bash", "zsh", "py", "rs", "js", "jsx", "ts", "tsx", "json", "yaml", "yml", "toml", "xml", "html", "css", "inpcrd", "rst7", "crd", "rst", "par", "prm", "rtf", "str", "key", "chk", "checkpoint", "state"],
  },
];

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenPaths = (paths: string[]) => unknown | Promise<unknown>;

type UseAppOpenActionsOptions = {
  openPaths: OpenPaths;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  recentStructures: RecentStructure[];
};

export function useAppOpenActions({
  openPaths,
  pushErrorStatus,
  pushStatus,
  recentStructures,
}: UseAppOpenActionsOptions) {
  const openRecentStructure = useCallback(
    async (structure: RecentStructure) => {
      await openPaths([structure.path]);
    },
    [openPaths],
  );

  const openMostRecentStructure = useCallback(async () => {
    const structure = recentStructures[0];
    if (!structure) {
      pushStatus("No recent structures to open", "error");
      return;
    }
    await openRecentStructure(structure);
  }, [openRecentStructure, pushStatus, recentStructures]);

  const chooseFiles = useCallback(async () => {
    try {
      const selection = isTauriRuntime()
        ? await invoke<string[]>("pick_open_targets")
        : await open({ multiple: true, filters });
      const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
      await openPaths(paths);
    } catch (error) {
      pushErrorStatus(error, "Open failed");
    }
  }, [openPaths, pushErrorStatus]);

  return {
    chooseFiles,
    openMostRecentStructure,
    openRecentStructure,
  };
}
