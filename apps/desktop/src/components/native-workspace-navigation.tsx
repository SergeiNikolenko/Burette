import { pageKind } from "./editor-area/page-kinds";
import { RadixDropdownMenu } from "./radix-menu";
import type { MenuItemSpec } from "./menu-types";
import type { ShellActions, ShellViewState } from "./types";
import { AnimatedOrbitIcon } from "./ui/animated-icons";
import { History, SidebarLeft, SidebarLeftHidden } from "./ui/app-icons";
import { ShortcutTooltip } from "./shortcut-tooltip";
import "./native-workspace-navigation.css";

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

// Sits at the same top-left spot whether the sidebar is open (its top row) or
// closed (the file header), like the Codex title bar toggle.
function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <ShortcutTooltip label={open ? "Hide sidebar" : "Show sidebar"}>
    <button type="button" className="chrome-button native-sidebar-toggle" aria-pressed={open}
      aria-label={open ? "Hide workspace navigation" : "Show workspace navigation"} onClick={onToggle}>
      {open ? <SidebarLeft size={18} aria-hidden /> : <SidebarLeftHidden size={18} aria-hidden />}
    </button>
  </ShortcutTooltip>;
}

export function NativeWorkspaceMenu({ state, actions, onShowSidebar, fileItems = [] }: Props & {
  fileItems?: MenuItemSpec[];
  /** Expanded workspaces own a sidebar; compact cards list pages in a menu. */
  onShowSidebar?: () => void;
}) {
  if (onShowSidebar) return <SidebarToggle open={false} onToggle={onShowSidebar} />;
  const items: MenuItemSpec[] = [
    { kind: "item", id: "home", text: "Recent files", action: () => homeAction({ state, actions }) },
    { kind: "item", id: "ketcher", text: "Molecular editor", action: () => ketcherAction({ state, actions }) },
    ...(fileItems.length ? [{ kind: "submenu" as const, id: "file-actions", text: "Open in another application", items: fileItems }] : []),
    { kind: "separator" },
    ...openPages(state).map(({ tab, title }) => ({
      kind: "item" as const, id: tab.id, text: title,
      action: () => actions.selectTab(tab.id),
    })),
  ];
  return <RadixDropdownMenu items={items} align="start" trigger={<ShortcutTooltip label="Workspace pages"><button type="button" className="chrome-button native-sidebar-toggle"
    aria-label="Workspace pages"><SidebarLeftHidden size={18} aria-hidden /></button></ShortcutTooltip>} />;
}

// Codex sidebar anatomy: icon tool rows, a section title, then text-only rows.
export function NativeWorkspaceSidebar({ state, actions, onToggleSidebar }: Props & { onToggleSidebar?: () => void }) {
  const pages = openPages(state);
  const current = state.activeTab?.location.kind;
  return <nav aria-label="Workspace navigation" className="sidebar native-workspace-sidebar">
    <div className="native-workspace-sidebar-top">
      {onToggleSidebar ? <SidebarToggle open onToggle={onToggleSidebar} /> : null}
    </div>
    <div className="sidebar-scroll">
      <button type="button" className="sidebar-tool-row" aria-current={current === "launcher" ? "page" : undefined}
        onClick={() => homeAction({ state, actions })}>
        <span className="sidebar-tool-icon" aria-hidden="true"><History size={16} /></span>
        <span className="sidebar-tool-label">Recent files</span>
      </button>
      <button type="button" className="sidebar-tool-row" aria-current={current === "ketcher" ? "page" : undefined}
        onClick={() => ketcherAction({ state, actions })}>
        <span className="sidebar-tool-icon" aria-hidden="true"><AnimatedOrbitIcon size={16} /></span>
        <span className="sidebar-tool-label">Molecular editor</span>
      </button>
      {pages.length ? <section className="sidebar-section" aria-labelledby="native-open-pages">
        <div className="sidebar-section-header"><h2 id="native-open-pages" className="native-workspace-section-title">Open pages</h2></div>
        {pages.map(({ tab, title }) => <button key={tab.id} type="button" className="sidebar-tool-row native-workspace-page"
          aria-current={tab.id === state.activeTabId ? "page" : undefined} onClick={() => actions.selectTab(tab.id)}>
          <span className="sidebar-tool-label">{title}</span>
        </button>)}
      </section> : null}
    </div>
  </nav>;
}
