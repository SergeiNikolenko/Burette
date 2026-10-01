import { pageKind } from "./editor-area/page-kinds";
import { RadixDropdownMenu } from "./radix-menu";
import type { MenuItemSpec } from "./menu-types";
import type { ShellActions, ShellViewState } from "./types";
import { AnimatedOrbitIcon } from "./ui/animated-icons";
import { SidebarLeft } from "./ui/app-icons";
import { Button } from "./ui/button";

type Props = { state: ShellViewState; actions: ShellActions };

function openPages(state: ShellViewState) {
  const pages = state.tabs.filter(tab => !["launcher", "settings", "ketcher"].includes(tab.location.kind))
    .map(tab => ({ tab, title: pageKind(tab.location).title(tab.location, state) }));
  return pages.map(({ tab, title }) => {
    if (pages.filter(page => page.title === title).length < 2) return { tab, title };
    const location = tab.location;
    const document = location.kind === "file" ? state.documents.find(item => item.id === location.documentId || item.path === location.path) : null;
    const view = document?.renderer === "grid2d" ? "2D grid" : document?.renderer === "molstar" ? "3D" : document?.renderer === "xyzrender-external" ? "xyzrender" : "page";
    const index = pages.filter(page => page.title === title).findIndex(page => page.tab.id === tab.id) + 1;
    return { tab, title: `${title} · ${view} ${index}` };
  });
}

function homeAction({ state, actions }: Props) {
  const home = state.tabs.find(tab => tab.location.kind === "launcher");
  if (home) actions.selectTab(home.id);
  else actions.openNewTab();
}

function ketcherAction({ state, actions }: Props) {
  const editor = state.tabs.find(tab => tab.location.kind === "ketcher");
  if (editor) actions.selectTab(editor.id);
  else actions.openKetcher();
}

export function NativeWorkspaceMenu({ state, actions, sidebarVisible, onToggleSidebar, fileItems = [] }: Props & {
  fileItems?: MenuItemSpec[];
  sidebarVisible: boolean; onToggleSidebar?: () => void;
}) {
  const items: MenuItemSpec[] = [
    { kind: "item", id: "home", text: "Recent files", action: () => homeAction({ state, actions }) },
    { kind: "item", id: "ketcher", text: "Ketcher", action: () => ketcherAction({ state, actions }) },
    ...(fileItems.length ? [{ kind: "submenu" as const, id: "file-actions", text: "Open in another application", items: fileItems }] : []),
    { kind: "separator" },
    ...openPages(state).map(({ tab, title }) => ({
      kind: "item" as const, id: tab.id, text: title,
      action: () => actions.selectTab(tab.id),
    })),
  ];
  return <div className="flex shrink-0 items-center gap-1">
    {onToggleSidebar ? <button type="button" className="workspace-file-icon-button workspace-file-pill"
      aria-label={sidebarVisible ? "Hide workspace navigation" : "Show workspace navigation"}
      aria-pressed={sidebarVisible} onClick={onToggleSidebar}><SidebarLeft size={18} aria-hidden /></button> : null}
    {!sidebarVisible ? <RadixDropdownMenu items={items} align="start" trigger={<button type="button" className="workspace-file-pill"
      aria-label="Workspace pages" title="Burette pages and file actions"><span className="px-1 text-xs font-medium">Burette</span></button>} /> : null}
  </div>;
}

export function NativeWorkspaceSidebar({ state, actions }: Props) {
  const pages = openPages(state);
  return <nav aria-label="Workspace navigation" className="flex h-full flex-col gap-5 overflow-y-auto border-r border-border bg-muted/40 px-3 py-5 text-foreground">
    <div className="flex flex-col gap-1">
      <Button variant="ghost" className="justify-start gap-2 aria-[current=page]:bg-accent" aria-current={state.activeTab?.location.kind === "launcher" ? "page" : undefined}
        onClick={() => homeAction({ state, actions })}>Recent files</Button>
      <Button variant="ghost" className="justify-start gap-2 aria-[current=page]:bg-accent" aria-current={state.activeTab?.location.kind === "ketcher" ? "page" : undefined} onClick={() => ketcherAction({ state, actions })}><AnimatedOrbitIcon size={16} aria-hidden />Ketcher</Button>
    </div>
    {pages.length ? <section className="flex min-h-0 flex-col gap-2" aria-label="Open pages">
      <h2 className="px-2 text-xs font-medium text-muted-foreground">Open pages</h2>
      {pages.map(({ tab, title }) => <Button key={tab.id} variant="ghost"
        className={`justify-start overflow-hidden ${tab.id === state.activeTabId ? "bg-accent" : ""}`}
        aria-current={tab.id === state.activeTabId ? "page" : undefined} onClick={() => actions.selectTab(tab.id)}>
        <span className="truncate">{title}</span>
      </Button>)}
    </section> : null}
  </nav>;
}
