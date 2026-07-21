import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { RadixDropdownMenu } from "./radix-menu";
import { ShortcutTooltip } from "./shortcut-tooltip";
import type { ChemicalEditorTarget, ShellActions, ShellViewState } from "./types";
import type { MenuItemSpec } from "./menu-types";
import { isTauriRuntime } from "../lib/tauri";
import { useFinderIconUrl } from "../hooks/use-finder-icon-url";
import { useDefaultApplicationIconUrl } from "../hooks/use-default-application-icon-url";

type ActiveFile = {
  path: string;
  label: string;
};

export function OpenInEditorMenu({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const activeFile = useMemo(() => activeFileFromState(state), [state]);
  const finderIconUrl = useFinderIconUrl();
  const defaultApplicationIconUrl = useDefaultApplicationIconUrl(activeFile?.path ?? null);
  const [targets, setTargets] = useState<ChemicalEditorTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);

  const refreshTargets = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const next = await actions.listChemicalEditorTargets(path);
      setTargets(next);
      setLoadedPath(path);
    } finally {
      setLoading(false);
    }
  }, [actions]);

  useEffect(() => {
    if (!activeFile) {
      setTargets([]);
      setLoadedPath(null);
      return;
    }
    void refreshTargets(activeFile.path);
  }, [activeFile?.path, refreshTargets]);

  const items = useMemo<MenuItemSpec[]>(() => {
    if (!activeFile) {
      return [{ kind: "item", id: "no-active-file", text: "Open a file first", disabled: true }];
    }
    const visibleTargets = targets.length > 0 ? targets : browserDevPreviewTargets(activeFile.path);
    const targetItems: MenuItemSpec[] = visibleTargets.map((target) => ({
      kind: "item",
      id: `chemical-editor-${target.id}`,
      text: target.name,
      iconText: editorIconText(target.name),
      iconUrl: editorIconUrl(target) ?? undefined,
      action: () => {
        void actions.openPathInChemicalEditor(activeFile.path, target.id, target.name);
      },
    }));
    return [
      ...(loading && loadedPath !== activeFile.path ? [{
        kind: "item" as const,
        id: "chemical-editor-loading",
        text: "Finding editors...",
        disabled: true,
      }] : []),
      ...(targetItems.length > 0 ? targetItems : [{
        kind: "item" as const,
        id: "chemical-editor-empty",
        text: "No compatible chemical editors found",
        disabled: true,
      }]),
      { kind: "separator" as const },
      {
        kind: "item" as const,
        id: "chemical-editor-default",
        text: "Open with Default App",
        iconText: "DA",
        iconUrl: defaultApplicationIconUrl ?? undefined,
        action: () => {
          void actions.openPathWithDefaultApp(activeFile.path);
        },
      },
      {
        kind: "item" as const,
        id: "chemical-editor-finder",
        text: "Reveal in Finder",
        iconText: "FI",
        iconUrl: finderIconUrl ?? undefined,
        action: () => {
          void actions.revealPath(activeFile.path, activeFile.label);
        },
      },
    ];
  }, [actions, activeFile, defaultApplicationIconUrl, finderIconUrl, loadedPath, loading, targets]);

  if (!activeFile) return null;

  const visibleTargets = targets.length > 0 ? targets : browserDevPreviewTargets(activeFile.path);
  const preferredTarget = preferredTargetForDestination(state.preferences.openInDefaultDestination, visibleTargets);
  const preferredIconUrl = openDestinationIconUrl(
    state.preferences.openInDefaultDestination,
    preferredTarget,
    finderIconUrl,
    defaultApplicationIconUrl,
  );
  const label = openDestinationLabel(state.preferences.openInDefaultDestination, preferredTarget);

  return (
    <RadixDropdownMenu
      align="end"
      side="bottom"
      sideOffset={6}
      contentClassName="open-editor-menu-content"
      items={items}
      trigger={(
        <button
          type="button"
          className="chrome-button open-editor-trigger"
          onMouseDown={(event) => event.preventDefault()}
          aria-label={label}
          title={label}
        >
          <span className={preferredIconUrl ? "open-editor-trigger-icon open-editor-trigger-icon-image" : "open-editor-trigger-icon"} aria-hidden="true">
            {preferredIconUrl ? (
              <img src={preferredIconUrl} alt="" aria-hidden="true" />
            ) : openDestinationIconText(state.preferences.openInDefaultDestination, preferredTarget)}
          </span>
          <svg className="open-editor-chevron" width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <path d="M3.5 5 6.5 8 9.5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <ShortcutTooltip label={label} />
        </button>
      )}
    />
  );
}

function preferredTargetForDestination(destination: string, targets: ChemicalEditorTarget[]) {
  if (destination.startsWith("editor:")) {
    const targetId = destination.slice("editor:".length);
    return targets.find((target) => target.id === targetId) ?? targets[0] ?? null;
  }
  if (destination === "default-app" || destination === "finder") return null;
  return null;
}

function openDestinationLabel(destination: string, target: ChemicalEditorTarget | null) {
  if (destination === "default-app") return "Open with Default App";
  if (target) return `Open in ${target.name}`;
  return "Reveal in Finder";
}

function openDestinationIconUrl(
  destination: string,
  target: ChemicalEditorTarget | null,
  finderIconUrl: string | null,
  defaultApplicationIconUrl: string | null,
) {
  if (target) return editorIconUrl(target);
  if (destination === "finder" || destination === "auto") return finderIconUrl;
  if (destination === "default-app") return defaultApplicationIconUrl;
  return null;
}

function openDestinationIconText(destination: string, target: ChemicalEditorTarget | null) {
  if (destination === "default-app") return "DA";
  if (destination === "finder" || destination === "auto") return "FI";
  return target ? editorIconText(target.name) : "OP";
}

function activeFileFromState(state: ShellViewState): ActiveFile | null {
  if (state.activeDocument?.path) {
    return { path: state.activeDocument.path, label: "structure" };
  }
  const location = state.activeTab?.location;
  if (location?.kind !== "text-file") return null;
  const document = state.textDocuments.find((candidate) => (
    candidate.id === location.documentId || candidate.path === location.path
  ));
  return document?.path ? { path: document.path, label: "file" } : null;
}

function editorIconText(name: string) {
  const compact = name.replace(/[^a-z0-9]+/giu, " ").trim();
  const parts = compact.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return compact.slice(0, 2).toUpperCase() || "ED";
}

function editorIconUrl(target: ChemicalEditorTarget) {
  if (target.iconUrl) return target.iconUrl;
  if (target.iconPath && isTauriRuntime()) return convertFileSrc(target.iconPath);
  if (!isTauriRuntime() && import.meta.env.DEV) return browserDevIconUrl(target);
  return null;
}

function browserDevIconUrl(target: ChemicalEditorTarget) {
  const appPath = target.appPath.toLowerCase();
  const name = target.name.toLowerCase();
  if (appPath.includes("maestro.app") || name === "maestro") return "/__burette/app-icon/maestro.png";
  if (appPath.includes("chimerax") || name === "chimerax") return "/__burette/app-icon/chimerax.png";
  if (appPath.includes("pymol.app") || name === "pymol") return "/__burette/app-icon/pymol.png";
  if (appPath.includes("avogadro") || name.startsWith("avogadro")) return "/__burette/app-icon/avogadro2.png";
  if (appPath.includes("datawarrior") || name === "datawarrior") return "/__burette/app-icon/datawarrior.png";
  if (appPath.includes("vesta") || name === "vesta") return "/__burette/app-icon/vesta.png";
  return null;
}

function browserDevPreviewTargets(path: string): ChemicalEditorTarget[] {
  if (isTauriRuntime() || !import.meta.env.DEV) return [];
  const params = new URLSearchParams(window.location.search);
  if (!params.has("devFiles")) return [];
  const previewTargets: Array<{
    name: string;
    bundleId: string;
    appPath: string;
    iconUrl: string;
    supportedExtensions: string[];
  }> = [
    {
      name: "Maestro",
      bundleId: "com.schrodinger.maestro",
      appPath: "/Applications/SchrodingerSuites2026-1/Maestro.app",
      iconUrl: "/__burette/app-icon/maestro.png",
      supportedExtensions: ["pdb", "cif", "sdf", "mol2", "mae"],
    },
    {
      name: "ChimeraX",
      bundleId: "edu.ucsf.rbvi.ChimeraX",
      appPath: "/Applications/ChimeraX-1.10.app",
      iconUrl: "/__burette/app-icon/chimerax.png",
      supportedExtensions: ["pdb", "cif", "mol2", "sdf"],
    },
    {
      name: "PyMOL",
      bundleId: "org.pymol.PyMOL",
      appPath: "/Applications/PyMOL.app",
      iconUrl: "/__burette/app-icon/pymol.png",
      supportedExtensions: ["pdb", "cif", "mol2"],
    },
    {
      name: "Avogadro2",
      bundleId: "org.openchemistry.Avogadro2",
      appPath: "/Applications/Avogadro2.app",
      iconUrl: "/__burette/app-icon/avogadro2.png",
      supportedExtensions: ["pdb", "cif", "sdf", "mol", "mol2", "xyz"],
    },
    {
      name: "DataWarrior",
      bundleId: "com.actelion.research.datawarrior",
      appPath: "/Applications/DataWarrior.app",
      iconUrl: "/__burette/app-icon/datawarrior.png",
      supportedExtensions: ["sdf", "mol", "smi", "csv"],
    },
    {
      name: "VESTA",
      bundleId: "jp.riken.VESTA",
      appPath: "/Applications/VESTA.app",
      iconUrl: "/__burette/app-icon/vesta.png",
      supportedExtensions: ["cif", "pdb", "xyz"],
    },
  ];

  return previewTargets.map((target, index) => ({
      id: `browser-dev-${target.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`,
      name: target.name,
      bundleId: target.bundleId,
      appPath: target.appPath,
      iconUrl: target.iconUrl,
      rank: (index + 1) * 10,
      supportedExtensions: target.supportedExtensions,
      matchReason: "Browser dev preview target",
  }));
}
