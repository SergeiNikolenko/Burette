import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Cancel01Icon,
  File02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { appInstanceLabel } from "../../lib/instance";
import { ScrollFade } from "../scroll-fade";
import { rendererLabel } from "../format";
import type { ShellActions, ShellViewState } from "../types";

export const Sidebar = forwardRef<HTMLButtonElement, {
  state: ShellViewState;
  actions: ShellActions;
}>(({ state, actions }, searchRef) => {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState({
    left: 12,
    top: 528,
    width: 210,
    maxHeight: 260,
  });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);

  const updateWorkspaceMenuPosition = useCallback(() => {
    const button = workspaceButtonRef.current;
    if (!button) return;
    const margin = 8;
    const menuHeight = 68;
    const rect = button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 210), window.innerWidth - margin * 2);
    setWorkspaceMenuPosition({
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
      top: Math.max(margin, rect.top - menuHeight - margin),
      width,
      maxHeight: Math.max(48, rect.top - margin * 2),
    });
  }, []);

  useEffect(() => {
    if (!workspaceMenuOpen) return undefined;
    updateWorkspaceMenuPosition();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceMenuOpen(false);
    };
    const onResize = () => updateWorkspaceMenuPosition();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [updateWorkspaceMenuPosition, workspaceMenuOpen]);

  const runWorkspaceAction = (action: () => void | Promise<void>) => {
    setWorkspaceMenuOpen(false);
    void action();
  };

  const toggleWorkspaceMenu = () => {
    if (!workspaceMenuOpen) updateWorkspaceMenuPosition();
    setWorkspaceMenuOpen((open) => !open);
  };

  const workspaceMenuStyle = {
    "--workspace-menu-left": workspaceMenuPosition.left + "px",
    "--workspace-menu-top": workspaceMenuPosition.top + "px",
    "--workspace-menu-width": workspaceMenuPosition.width + "px",
    "--workspace-menu-max-height": workspaceMenuPosition.maxHeight + "px",
  } as CSSProperties;

  return (
    <aside className="sidebar" style={{ width: state.sidebarWidth }}>
      <div className="sidebar-spacer" data-tauri-drag-region />
      <ScrollFade className="sidebar-scroll">
        <button
          ref={searchRef}
          type="button"
          className="sidebar-search-row"
          onClick={actions.openCommandPalette}
          aria-label="Search"
        >
          <span className="sidebar-search-icon" aria-hidden="true">
            <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
          </span>
          <span className="sidebar-search-label">Search</span>
          <kbd>⌘<span>P</span></kbd>
        </button>
        <SidebarSection title="Open">
          {state.documents.length === 0 ? (
            <div className="empty-sidebar">No open structures</div>
          ) : state.visibleDocuments.length === 0 ? (
            <div className="empty-sidebar">No matching structures</div>
          ) : (
            <div className="project-list" role="list">
              {state.visibleDocuments.map((document) => (
                <div
                  key={document.id}
                  role="button"
                  tabIndex={0}
                  className={state.page === "viewer" && document.id === state.activeDocumentId ? "project active" : "project"}
                  onClick={() => actions.selectDocument(document.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      actions.selectDocument(document.id);
                    }
                  }}
                  aria-label={document.title + ", " + rendererLabel(document.renderer)}
                  title={rendererLabel(document.renderer)}
                >
                  <span className="project-icon" aria-hidden="true">
                    <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={2} />
                  </span>
                  <span className="project-name">{document.title}</span>
                  <button
                    type="button"
                    className="close-hit"
                    aria-label={"Close " + document.title}
                    onClick={(event) => {
                      event.stopPropagation();
                      actions.closeDocument(document.id);
                    }}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={14} color="currentColor" strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SidebarSection>
        {state.recentStructures.length > 0 && (
          <SidebarSection title="Recent">
            <div className="project-list" role="list">
              {state.recentStructures.map((structure) => (
                <div
                  key={structure.path}
                  role="button"
                  tabIndex={0}
                  className="project recent-project"
                  onClick={() => void actions.openRecentStructure(structure)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void actions.openRecentStructure(structure);
                    }
                  }}
                  aria-label={"Open recent " + structure.title}
                  title={rendererLabel(structure.renderer)}
                >
                  <span className="project-icon" aria-hidden="true">
                    <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={2} />
                  </span>
                  <span className="project-name">{structure.title}</span>
                </div>
              ))}
            </div>
          </SidebarSection>
        )}
      </ScrollFade>
      <div className="sidebar-footer" ref={menuRef}>
        {workspaceMenuOpen && (
          <div className="sidebar-workspace-menu" role="menu" aria-label="Workspace actions" style={workspaceMenuStyle}>
            <button type="button" role="menuitem" onClick={() => runWorkspaceAction(actions.chooseWorkspace)}>
              Choose workspace...
            </button>
            <button type="button" role="menuitem" onClick={() => runWorkspaceAction(actions.openWorkspaceFolder)}>
              Open folder
            </button>
          </div>
        )}
        <button
          ref={workspaceButtonRef}
          type="button"
          className="sidebar-product"
          onClick={toggleWorkspaceMenu}
          aria-haspopup="menu"
          aria-expanded={workspaceMenuOpen}
          aria-label={"Open workspace menu for " + appInstanceLabel}
          title={appInstanceLabel}
        >
          <span className="sidebar-product-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeLinejoin="round">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M8.7071 2.39644C8.31658 2.00592 7.68341 2.00592 7.29289 2.39644L4.46966 5.21966L3.93933 5.74999L4.99999 6.81065L5.53032 6.28032L7.99999 3.81065L10.4697 6.28032L11 6.81065L12.0607 5.74999L11.5303 5.21966L8.7071 2.39644ZM5.53032 9.71966L4.99999 9.18933L3.93933 10.25L4.46966 10.7803L7.29289 13.6035C7.68341 13.9941 8.31658 13.9941 8.7071 13.6035L11.5303 10.7803L12.0607 10.25L11 9.18933L10.4697 9.71966L7.99999 12.1893L5.53032 9.71966Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="sidebar-product-label">{appInstanceLabel}</span>
        </button>
      </div>
    </aside>
  );
});
Sidebar.displayName = "Sidebar";

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sidebar-section" aria-label={title}>
      {children}
    </section>
  );
}
