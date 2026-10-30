import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/tauri";
import { pickWebDemoFiles } from "../lib/web-demo-workspace";
import { summarizeErrors } from "../lib/file-routing";
import { toast } from "./ui/toast";
import type { DockArea, DockFileEntry } from "../lib/dock";
import { useSidebarStructureDrag } from "./sidebar/use-sidebar-structure-drag";
import type { ShellActions, ShellViewState } from "./types";
import { fileCapabilities, menuItem } from "./workspace-menu-items";
import { showNativeContextMenu } from "./native-context-menu";
import { FileBlank, Atom, Plus } from "./ui/app-icons";
import { Button } from "./ui/button";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { requestContextualGuide } from "./onboarding/request";

export function DockFileTabs({ area, entries, activeKey, textViews, onTextView, actions, state }: {
  area: DockArea;
  entries: DockFileEntry[];
  activeKey: string | null;
  textViews: Record<string, boolean>;
  onTextView: (key: string, text: boolean) => void;
  actions: ShellActions;
  state: ShellViewState;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const choose = async () => {
    setOpening(true); setError(false);
    try {
      const picked = isTauriRuntime() ? { paths: await invoke<string[]>("pick_open_targets"), scientific: [], errors: [] } : await pickWebDemoFiles();
      if (picked?.errors.length) toast.add({ title: "Some files could not be opened", description: summarizeErrors(picked.errors), type: "error" });
      if (picked?.paths.length) await actions.openDockPayload({ area, tabKind: "files", payload: { paths: picked.paths, records: [] } });
      // Quantum outputs open as their own documents, as from the main Open.
      if (picked?.scientific.length) await actions.openPaths(picked.scientific);
    } catch { setError(true); }
    finally { setOpening(false); }
  };
  return <div className="dock-file-tabs" role="tablist" aria-label={`${area} dock files`}>
    {entries.map((entry) => {
      const active = entry.key === activeKey;
      const text = textViews[entry.key] ?? entry.kind === "text-document";
      const payload = entry.kind === "tool" ? { paths: [], records: [], items: [{ kind: "ketcher" as const, title: entry.title }] }
        : { paths: [entry.path], records: [], items: [{ kind: text ? "writer" as const : "file" as const, path: entry.path, title: entry.title }] };
      const select = () => entry.kind === "tool" ? actions.setDockTool(area, "ketcher") : actions.setDockDocument(area, entry.documentId);
      const menu = (event: React.MouseEvent<HTMLElement>) => {
        if (entry.kind === "tool") return;
        event.preventDefault();
        event.stopPropagation();
        const capabilities = fileCapabilities(entry.path);
        const tab = event.currentTarget.closest(".dock-tab-shell") ?? event.currentTarget;
        const renderer = (rendererMode: "auto" | "molstar" | "xyzrender-external") => {
          onTextView(entry.key, false);
          return actions.openDockPayload({ area, tabKind: "files", payload, rendererMode });
        };
        const destination = area === "right" ? "bottom" : "right";
        const items = [
          menuItem("dock-file-other-panel", destination === "right" ? "Open in right panel" : "Open in bottom panel", () => actions.openDockPayload({ area: destination, tabKind: "files", payload })),
          menuItem("dock-file-main", "Open in main area", () => actions.openPaths([entry.path])),
          ...(entry.kind !== "media" && capabilities.text ? [menuItem("dock-file-text", "Text", () => {
            select(); onTextView(entry.key, true);
            if (entry.kind === "document") requestContextualGuide("source-dock", tab);
          })] : []),
          menuItem("dock-file-preview", "Preview", () => {
            if (entry.kind === "text-document") return renderer("auto");
            select(); onTextView(entry.key, false);
          }),
          ...(capabilities.scene || capabilities.xyzrender ? [menuItem("open-3d", "Interactive 3D", () => renderer("molstar"))] : []),
          ...(capabilities.xyzrender ? [menuItem("open-xyzrender", "3D render", () => renderer("xyzrender-external"))] : []),
        ];
        void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
      };
      return <DockFileTab key={entry.key} active={active} payload={payload} state={state} actions={actions} menu={menu}
        entry={entry} text={text} select={select} />;
    })}
    <ShortcutTooltip label={`Open file in ${area} panel`}>
      <Button variant="ghost" size="icon-sm" aria-label={`Open file in ${area} panel`} disabled={opening} onClick={() => void choose()}><Plus aria-hidden="true" /></Button>
    </ShortcutTooltip>
    {error && <Button variant="ghost" size="sm" onClick={() => void choose()}>Retry opening file</Button>}
  </div>;
}

function DockFileTab({ active, payload, state, actions, menu, entry, text, select }: {
  active: boolean;
  payload: import("../lib/structure-drag").StructureDragPayload;
  state: ShellViewState;
  actions: ShellActions;
  menu: (event: React.MouseEvent<HTMLElement>) => void;
  entry: DockFileEntry;
  text: boolean;
  select: () => void;
}) {
  const drag = useSidebarStructureDrag({ state, actions, getPayload: () => payload });
  return <div className="dock-tab-shell" data-active={active || undefined} onContextMenu={menu}>
    {entry.kind !== "tool" && <Button variant="ghost" size="icon-2xs" aria-label={`View options for ${entry.title}`} onClick={menu}>
      {text || entry.kind === "media" ? <FileBlank aria-hidden="true" /> : <Atom aria-hidden="true" />}
    </Button>}
    <ShortcutTooltip label={entry.kind === "tool" ? entry.title : entry.path}>
      <Button variant="ghost" size="sm" className="dock-file-tab" role="tab" aria-selected={active}
        draggable {...drag} onClick={select}>{entry.title}</Button>
    </ShortcutTooltip>
  </div>;
}
