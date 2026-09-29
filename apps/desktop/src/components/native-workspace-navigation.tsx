import { pageKind } from "./editor-area/page-kinds";
import { RadixDropdownMenu } from "./radix-menu";
import type { MenuItemSpec } from "./menu-types";
import type { ShellActions, ShellViewState } from "./types";
import { Atom, Edit, SidebarLeft } from "./ui/app-icons";
import { Button } from "./ui/button";

type Props = { state: ShellViewState; actions: ShellActions };

function homeAction({ state, actions }: Props) {
  const home = state.tabs.find(tab => tab.location.kind === "launcher");
  if (home) actions.selectTab(home.id);
  else actions.openNewTab();
}

export function NativeWorkspaceMenu({ state, actions, sidebarVisible, onToggleSidebar, fileItems = [] }: Props & {
  fileItems?: MenuItemSpec[];
  sidebarVisible: boolean; onToggleSidebar?: () => void;
}) {
  const items: MenuItemSpec[] = [
    { kind: "item", id: "home", text: "Home", action: () => homeAction({ state, actions }) },
    { kind: "item", id: "ketcher", text: "Draw a molecule", action: actions.openKetcher },
    ...(fileItems.length ? [{ kind: "submenu" as const, id: "file-actions", text: "Open in another application", items: fileItems }] : []),
    { kind: "separator" },
    ...state.tabs.filter(tab => tab.location.kind !== "launcher" && tab.location.kind !== "settings").map(tab => ({
      kind: "item" as const, id: tab.id, text: pageKind(tab.location).title(tab.location, state),
      action: () => actions.selectTab(tab.id),
    })),
  ];
  return <div className="flex shrink-0 items-center gap-1">
    {onToggleSidebar ? <button type="button" className="workspace-file-icon-button workspace-file-pill"
      aria-label={sidebarVisible ? "Hide workspace navigation" : "Show workspace navigation"}
      aria-pressed={sidebarVisible} onClick={onToggleSidebar}><SidebarLeft size={18} aria-hidden /></button> : null}
    <RadixDropdownMenu items={items} align="start" trigger={<button type="button" className="workspace-file-icon-button workspace-file-pill"
      aria-label="Workspace pages" title="Burette pages and file actions"><Atom size={18} aria-hidden /></button>} />
  </div>;
}

export function NativeWorkspaceSidebar({ state, actions }: Props) {
  const tabs = state.tabs.filter(tab => tab.location.kind !== "launcher" && tab.location.kind !== "settings");
  return <nav aria-label="Workspace navigation" className="flex h-full flex-col gap-5 overflow-y-auto border-r border-border bg-muted/40 px-3 py-5 text-foreground">
    <div className="flex items-center gap-2 px-2 text-sm font-medium"><Atom size={18} aria-hidden />Burette</div>
    <div className="flex flex-col gap-1">
      <Button variant="ghost" className="justify-start gap-2" aria-current={state.activeTab?.location.kind === "launcher" ? "page" : undefined}
        onClick={() => homeAction({ state, actions })}><Atom size={16} aria-hidden />Home</Button>
      <Button variant="ghost" className="justify-start gap-2" onClick={actions.openKetcher}><Edit size={16} aria-hidden />Draw a molecule</Button>
    </div>
    <section className="flex min-h-0 flex-col gap-2" aria-label="Open pages">
      <h2 className="px-2 text-xs font-medium text-muted-foreground">Open pages</h2>
      {tabs.length ? tabs.map(tab => <Button key={tab.id} variant="ghost"
        className={`justify-start overflow-hidden ${tab.id === state.activeTabId ? "bg-accent" : ""}`}
        aria-current={tab.id === state.activeTabId ? "page" : undefined} onClick={() => actions.selectTab(tab.id)}>
        <span className="truncate">{pageKind(tab.location).title(tab.location, state)}</span>
      </Button>) : <p className="px-2 text-xs text-muted-foreground">Your structures and sketches appear here.</p>}
    </section>
  </nav>;
}
