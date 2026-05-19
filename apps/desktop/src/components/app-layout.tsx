import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CSSProperties } from "react";
import { ViewerArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { Sidebar } from "./sidebar";
import type { ShellActions, ShellViewState, StatusNotice } from "./types";
import { isTauriRuntime } from "../lib/tauri";

function clampSidebarWidth(width: number, maxSidebarWidth: number) {
  return Math.max(220, Math.min(maxSidebarWidth, Math.round(width)));
}

const collapsedChromeLeft = 132;

export function AppLayout({
  state,
  actions,
  searchRef,
  onDismissStatus,
  onToggleSidebar,
  onResizeStart,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  state: ShellViewState;
  actions: ShellActions;
  searchRef: React.Ref<HTMLButtonElement>;
  onDismissStatus: () => void;
  onToggleSidebar: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const maxSidebarWidth = Math.max(280, Math.min(420, Math.floor(viewportWidth * 0.35)));
  const sidebarWidth = clampSidebarWidth(state.sidebarWidth, maxSidebarWidth);
  const sidebarLayoutWidth = state.sidebarOpen ? sidebarWidth : 0;
  const layoutState = sidebarWidth === state.sidebarWidth ? state : { ...state, sidebarWidth };
  const tabChromeLeft = Math.max(sidebarLayoutWidth + 12, collapsedChromeLeft);
  const chromeTransition = state.sidebarDragging ? "none" : undefined;
  const shellStyle = {
    "--sidebar-layout-width": `${sidebarLayoutWidth}px`,
  } as CSSProperties;
  return (
    <main
      className="app-shell"
      data-theme={state.preferences.theme}
      data-runtime={isTauriRuntime() ? "tauri" : "browser"}
      data-drop-active={state.dropActive || undefined}
      data-sidebar-open={state.sidebarOpen ? "true" : "false"}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={shellStyle}
    >
      <div className="drag-region" data-tauri-drag-region />
      <button className="chrome-button sidebar-toggle-root" onClick={onToggleSidebar} title={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-label={state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
        <HugeiconsIcon icon={SidebarLeftIcon} size={18} color="currentColor" strokeWidth={2} />
      </button>
      <header
        className="topbar"
        style={{ left: tabChromeLeft, transition: chromeTransition }}
      >
        <EditorTabs state={layoutState} actions={actions} />
      </header>
      <section className="workspace">
        <div className="sidebar-shell" data-open={state.sidebarOpen ? "true" : "false"} style={{ transition: chromeTransition }}>
          <Sidebar ref={searchRef} state={layoutState} actions={actions} open={state.sidebarOpen} />
        </div>
        <div
          className="splitter"
          onPointerDown={state.sidebarOpen ? onResizeStart : undefined}
          data-open={state.sidebarOpen ? "true" : "false"}
          data-dragging={state.sidebarDragging || undefined}
        />
        <section className="main-stage">
          <ViewerArea state={layoutState} actions={actions} />
        </section>
      </section>
      {state.dropActive && (
        <div className="drop-overlay">
          <div>Drop structures to open</div>
        </div>
      )}
      {state.status && (
        <StatusSurface status={state.status} onDismiss={onDismissStatus} />
      )}
    </main>
  );
}

function StatusSurface({
  status,
  onDismiss,
}: {
  status: StatusNotice;
  onDismiss: () => void;
}) {
  const hasExtraDetails = status.details.length > 1;
  return (
    <section
      className="status-surface"
      data-kind={status.kind}
      role={status.kind === "error" ? "alert" : "status"}
      aria-live={status.kind === "error" ? "assertive" : "polite"}
    >
      <div className="status-surface-copy">
        <strong>{status.kind === "error" ? "Issue" : "Status"}</strong>
        <p>{status.message}</p>
        {hasExtraDetails && (
          <details className="status-surface-details">
            <summary>Show details</summary>
            <ul>
              {status.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <button
        type="button"
        className="status-surface-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss status"
      >
        Dismiss
      </button>
    </section>
  );
}
