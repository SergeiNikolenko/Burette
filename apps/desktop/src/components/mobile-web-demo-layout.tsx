import { useEffect, useState, type CSSProperties } from "react";
import { SidebarFileOperations } from "./sidebar/file-operations";
import { WorkspaceMenus } from "./workspace-menus";
import { Sidebar } from "./sidebar";
import { ViewerArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { DockPanel } from "./dock-panel";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import type { ShellActions, ShellViewState } from "./types";
import "../styles/mobile-web-demo.css";

export function MobileWebDemoLayout({ state, actions, style, theme }: {
  state: ShellViewState; actions: ShellActions; style: CSSProperties; theme: string;
}) {
  const [panel, setPanel] = useState<"files" | "right" | "bottom" | null>(null);
  useEffect(() => { setPanel(null); }, [state.activeTabId, state.activeDocument?.path, state.page]);
  const title = panel === "files" ? "Files" : panel === "right" ? "Inspector" : "Tools";
  return <SidebarFileOperations state={state} actions={actions}><WorkspaceMenus state={state} actions={actions}>
    <main className="app-shell mobile-web-demo" data-runtime="browser" data-theme={state.preferences.theme} data-effective-theme={theme} style={style}>
      <nav className="mobile-demo-nav" aria-label="Workspace">
        <button onClick={() => setPanel("files")}>Files</button>
        <strong>Burette</strong>
        <button onClick={() => setPanel("right")}>Inspector</button>
        <button onClick={() => setPanel("bottom")}>Tools</button>
      </nav>
      <header className="topbar"><EditorTabs state={state} actions={actions} /></header>
      <section className="main-stage"><ViewerArea state={state} actions={actions} /></section>
      <Dialog open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}>
        <DialogContent className="mobile-demo-panel">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{panel === "files" ? "Choose a file to view." : "Inspect and work with the current document."}</DialogDescription>
          {panel === "files" ? <Sidebar state={state} actions={actions} open /> : panel ? <DockPanel area={panel} state={{ ...state, rightDockOpen: panel === "right", bottomDockOpen: panel === "bottom" }} actions={{ ...actions, setDockOpen: (area, open) => { if (!open) setPanel(null); actions.setDockOpen(area, open); } }} /> : null}
        </DialogContent>
      </Dialog>
    </main>
  </WorkspaceMenus></SidebarFileOperations>;
}
