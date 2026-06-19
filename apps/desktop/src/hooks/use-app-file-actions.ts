import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";

import { formatBytes } from "../components/format";
import type { ChemicalEditorTarget } from "../components/types";
import { basename, parentDirectory } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import type { TextFileDocument, ViewerDocument } from "../types";

const browserDevChemicalEditorTargets: ChemicalEditorTarget[] = [
  {
    id: "browser-dev-maestro",
    name: "Maestro",
    bundleId: "com.schrodinger.maestro",
    appPath: "/Applications/SchrodingerSuites2026-1/Maestro.app",
    iconUrl: "/__burette/app-icon/maestro.png",
    rank: 10,
    supportedExtensions: ["pdb", "cif", "sdf", "mol2", "mae"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-chimerax",
    name: "ChimeraX",
    bundleId: "edu.ucsf.rbvi.ChimeraX",
    appPath: "/Applications/ChimeraX-1.10.app",
    iconUrl: "/__burette/app-icon/chimerax.png",
    rank: 20,
    supportedExtensions: ["pdb", "cif", "mol2", "sdf"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-pymol",
    name: "PyMOL",
    bundleId: "org.pymol.PyMOL",
    appPath: "/Applications/PyMOL.app",
    iconUrl: "/__burette/app-icon/pymol.png",
    rank: 30,
    supportedExtensions: ["pdb", "cif", "mol2"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-avogadro",
    name: "Avogadro2",
    bundleId: "org.openchemistry.Avogadro2",
    appPath: "/Applications/Avogadro2.app",
    iconUrl: "/__burette/app-icon/avogadro2.png",
    rank: 40,
    supportedExtensions: ["pdb", "cif", "sdf", "mol", "mol2", "xyz"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-datawarrior",
    name: "DataWarrior",
    bundleId: "com.actelion.research.datawarrior",
    appPath: "/Applications/DataWarrior.app",
    iconUrl: "/__burette/app-icon/datawarrior.png",
    rank: 50,
    supportedExtensions: ["sdf", "mol", "smi", "csv"],
    matchReason: "Browser dev preview target",
  },
  {
    id: "browser-dev-vesta",
    name: "VESTA",
    bundleId: "jp.riken.VESTA",
    appPath: "/Applications/VESTA.app",
    iconUrl: "/__burette/app-icon/vesta.png",
    rank: 60,
    supportedExtensions: ["cif", "pdb", "xyz"],
    matchReason: "Browser dev preview target",
  },
];

type UseAppFileActionsArgs = {
  activeDocument: ViewerDocument | null;
  activeTextDocument: TextFileDocument | null;
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
  pushStatus: (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
  writeClipboardText: (text: string) => Promise<void>;
};

export function useAppFileActions({
  activeDocument,
  activeTextDocument,
  pushErrorStatus,
  pushStatus,
  writeClipboardText,
}: UseAppFileActionsArgs) {
  const listChemicalEditorTargets = useCallback(async (path: string): Promise<ChemicalEditorTarget[]> => {
    if (!isTauriRuntime()) {
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      return browserDevChemicalEditorTargets.filter((target) => target.supportedExtensions.includes(extension));
    }
    try {
      return await invoke<ChemicalEditorTarget[]>("list_chemical_editor_targets", { path });
    } catch (error) {
      pushErrorStatus(error, "Chemical editor discovery failed");
      return [];
    }
  }, [pushErrorStatus]);

  const openPathInChemicalEditor = useCallback(async (path: string, targetId: string, targetName: string) => {
    try {
      if (!isTauriRuntime()) {
        await openPath(path);
        pushStatus(`Opened ${basename(path)}`);
        return;
      }
      await invoke("open_in_chemical_editor", { path, targetId });
      pushStatus(`Opened ${basename(path)} in ${targetName}`);
    } catch (error) {
      pushErrorStatus(error, `Open in ${targetName} failed`);
    }
  }, [pushErrorStatus, pushStatus]);

  const openPathWithDefaultApp = useCallback(async (path: string) => {
    try {
      await openPath(path);
      pushStatus(`Opened ${basename(path)}`);
    } catch (error) {
      pushErrorStatus(error, "Open with default app failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const revealPath = useCallback(async (path: string, label = "file") => {
    try {
      if (isTauriRuntime()) {
        await invoke("reveal_path", { path });
      } else {
        await openPath(parentDirectory(path) ?? path);
      }
      pushStatus(`Revealed ${label} in Finder`);
    } catch (error) {
      pushErrorStatus(error, "Reveal in Finder failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const revealDocument = useCallback(async (document: ViewerDocument) => {
    await revealPath(document.path, "structure");
  }, [revealPath]);

  const revealActiveDocument = useCallback(async () => {
    if (activeTextDocument) {
      await revealPath(activeTextDocument.path, "file");
      return;
    }
    if (!activeDocument) {
      pushStatus("No active file to reveal", "error");
      return;
    }
    await revealDocument(activeDocument);
  }, [activeDocument, activeTextDocument, pushStatus, revealDocument, revealPath]);

  const copyPath = useCallback(async (path: string, label = "file") => {
    try {
      await writeClipboardText(path);
      pushStatus(`Copied ${label} path`);
    } catch (error) {
      pushErrorStatus(error, "Copy path failed");
    }
  }, [pushErrorStatus, pushStatus, writeClipboardText]);

  const copyDocumentPath = useCallback(async (document: ViewerDocument) => {
    await copyPath(document.path, "structure");
  }, [copyPath]);

  const copyActiveDocumentPath = useCallback(async () => {
    if (activeTextDocument) {
      await copyPath(activeTextDocument.path, "file");
      return;
    }
    if (!activeDocument) {
      pushStatus("No active file path to copy", "error");
      return;
    }
    await copyDocumentPath(activeDocument);
  }, [activeDocument, activeTextDocument, copyDocumentPath, copyPath, pushStatus]);

  const showDocumentMetadata = useCallback((document: ViewerDocument) => {
    pushStatus(document.title, "info", [
      `Path: ${document.path}`,
      `Renderer: ${document.renderer}`,
      `Format: ${document.extension.toUpperCase()}`,
      `Size: ${formatBytes(document.byteCount)}`,
    ]);
  }, [pushStatus]);

  const showTextFileMetadata = useCallback((document: TextFileDocument) => {
    const details = [
      `Path: ${document.path}`,
      `Format: ${document.extension ? document.extension.toUpperCase() : "TEXT"}`,
      `Language: ${document.language}`,
      `Size: ${formatBytes(document.byteCount)}`,
    ];
    if (document.truncated) details.push("Content preview was truncated");
    pushStatus(document.title, "info", details);
  }, [pushStatus]);

  const showActiveDocumentMetadata = useCallback(() => {
    if (activeTextDocument) {
      showTextFileMetadata(activeTextDocument);
      return;
    }
    if (!activeDocument) {
      pushStatus("No active file metadata to show", "error");
      return;
    }
    showDocumentMetadata(activeDocument);
  }, [activeDocument, activeTextDocument, pushStatus, showDocumentMetadata, showTextFileMetadata]);

  return {
    copyActiveDocumentPath,
    copyDocumentPath,
    copyPath,
    listChemicalEditorTargets,
    openPathInChemicalEditor,
    openPathWithDefaultApp,
    revealActiveDocument,
    revealDocument,
    revealPath,
    showActiveDocumentMetadata,
    showDocumentMetadata,
    showTextFileMetadata,
  };
}
