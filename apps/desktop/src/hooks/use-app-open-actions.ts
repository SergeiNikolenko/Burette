import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import previewFormatRegistry from "../../../../config/preview-formats.json";
import type { StructureDragRecord } from "../lib/structure-drag";
import { normalizePdbId, rcsbPdbDownloadUrl } from "../lib/structure-fetch";
import { isTauriRuntime } from "../lib/tauri";
import type { RecentStructure } from "../types";
import { isWebDemoWorkspace, pickWebDemoFiles } from "../lib/web-demo-workspace";

const filters = [
  {
    name: "Files",
    extensions: [...previewFormatRegistry.documentTypes.extensions, "ms", "magma", "mgf", "msp", "mzML", "mzXML", "md", "markdown", "mdx", "txt", "log", "out", "err", "sh", "bash", "zsh", "py", "rs", "js", "jsx", "ts", "tsx", "json", "yaml", "yml", "toml", "xml", "html", "css", "inpcrd", "rst7", "crd", "rst", "par", "prm", "rtf", "str", "key", "chk", "checkpoint", "state"],
  },
];

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type OpenPaths = (paths: string[]) => unknown | Promise<unknown>;
type OpenStructureRecords = (records: StructureDragRecord[]) => unknown | Promise<unknown>;

type FetchStructureResult = {
  title: string;
  extension: string;
  text: string;
};

type UseAppOpenActionsOptions = {
  openPaths: OpenPaths;
  openStructureRecords: OpenStructureRecords;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  recentStructures: RecentStructure[];
};

export function useAppOpenActions({
  openPaths,
  openStructureRecords,
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
        : isWebDemoWorkspace()
          ? (await pickWebDemoFiles())?.paths ?? []
          : await open({ multiple: true, filters });
      const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
      await openPaths(paths);
    } catch (error) {
      pushErrorStatus(error, "Open failed");
    }
  }, [openPaths, pushErrorStatus]);

  const fetchPdbStructure = useCallback(async (input: string) => {
    const pdbId = normalizePdbId(input);
    if (!pdbId) {
      pushStatus("Enter a valid four-character PDB ID", "error");
      return;
    }

    pushStatus(`Fetching ${pdbId} from RCSB PDB...`);
    try {
      const result = isTauriRuntime()
        ? await invoke<FetchStructureResult>("fetch_pdb_structure", { request: { pdbId } })
        : await fetchBrowserDevPdbStructure(pdbId);
      await openStructureRecords([{
        path: result.title,
        inputExtension: result.extension,
        text: result.text,
      }]);
    } catch (error) {
      pushErrorStatus(error, `Fetch ${pdbId} failed`);
    }
  }, [openStructureRecords, pushErrorStatus, pushStatus]);

  return {
    chooseFiles,
    fetchPdbStructure,
    openMostRecentStructure,
    openRecentStructure,
  };
}

async function fetchBrowserDevPdbStructure(pdbId: string): Promise<FetchStructureResult> {
  const response = await fetch(rcsbPdbDownloadUrl(pdbId));
  if (!response.ok) {
    throw new Error(`RCSB PDB returned ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (!text.trim()) throw new Error("RCSB PDB returned an empty structure");
  return {
    title: `${pdbId}.pdb`,
    extension: "pdb",
    text,
  };
}
