import type { DockArea, DockFileEntry } from "../lib/dock";
import { writeStructureDragPayload } from "../lib/structure-drag";
import type { ShellActions } from "./types";
import { fileCapabilities, menuItem } from "./workspace-menu-items";
import { showNativeContextMenu } from "./native-context-menu";
import { FileBlank, Atom } from "./ui/app-icons";
import { Button } from "./ui/button";

export function DockFileTabs({ area, entries, activeKey, textViews, onTextView, actions }: {
  area: DockArea;
  entries: DockFileEntry[];
  activeKey: string | null;
  textViews: Record<string, boolean>;
  onTextView: (key: string, text: boolean) => void;
  actions: ShellActions;
}) {
  if (!entries.length) return null;
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
        const renderer = (rendererMode: "auto" | "molstar" | "xyzrender-external") => {
          onTextView(entry.key, false);
          return actions.openDockPayload({ area, tabKind: "files", payload, rendererMode });
        };
        const items = [
          ...(capabilities.text ? [menuItem("dock-file-text", "Text", () => { select(); onTextView(entry.key, true); })] : []),
          menuItem("dock-file-preview", "Preview", () => {
            if (entry.kind === "text-document") return renderer("auto");
            select(); onTextView(entry.key, false);
          }),
          ...(capabilities.scene || capabilities.xyzrender ? [menuItem("open-3d", "Mol*", () => renderer("molstar"))] : []),
          ...(capabilities.xyzrender ? [menuItem("open-xyzrender", "xyzrender", () => renderer("xyzrender-external"))] : []),
        ];
        void showNativeContextMenu(items, { x: event.clientX, y: event.clientY }, { forceWeb: true });
      };
      return <div key={entry.key} className="dock-tab-shell" data-active={active || undefined}
        draggable onDragStart={(event) => { writeStructureDragPayload(event.dataTransfer, payload); actions.setStructureDragActive(true); }}
        onDragEnd={() => actions.setStructureDragActive(false)} onContextMenu={menu}>
        {entry.kind !== "tool" && <Button variant="ghost" size="icon-2xs" aria-label={`View options for ${entry.title}`} onClick={menu}>
          {text ? <FileBlank aria-hidden="true" /> : <Atom aria-hidden="true" />}
        </Button>}
        <Button variant="ghost" size="sm" className="dock-file-tab" role="tab" aria-selected={active}
          title={entry.kind === "tool" ? entry.title : entry.path} onClick={select}>{entry.title}</Button>
      </div>;
    })}
  </div>;
}
