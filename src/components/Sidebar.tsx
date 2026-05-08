import { forwardRef } from "react";
import { formatBytes, rendererLabel } from "./format";
import type { ShellActions, ShellViewState } from "./types";

export const Sidebar = forwardRef<HTMLInputElement, {
  state: ShellViewState;
  actions: ShellActions;
  onQueryChange: (query: string) => void;
}>(({ state, actions, onQueryChange }, searchRef) => {
  return (
    <aside className="sidebar" style={{ width: state.sidebarWidth }}>
      <div className="sidebar-spacer" data-tauri-drag-region />
      <div className="sidebar-scroll">
        <div className="sidebar-title">Projects</div>
        <label className="sidebar-search-row">
          <input
            ref={searchRef}
            className="sidebar-search"
            value={state.sidebarQuery}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search structures"
            aria-label="Search open structures"
          />
          <kbd>⌘P</kbd>
        </label>
        {state.documents.length === 0 ? (
          <div className="empty-sidebar">No open structures</div>
        ) : state.visibleDocuments.length === 0 ? (
          <div className="empty-sidebar">No matching structures</div>
        ) : (
          <div className="project-list" role="list">
            {state.visibleDocuments.map((document) => (
              <button
                key={document.id}
                className={state.page === "viewer" && document.id === state.activeDocumentId ? "project active" : "project"}
                onClick={() => actions.selectDocument(document.id)}
                aria-label={document.title + ", " + rendererLabel(document.renderer)}
              >
                <span className="project-name">{document.title}</span>
                <span className="project-meta">{rendererLabel(document.renderer)} · {formatBytes(document.byteCount)}</span>
                <span
                  className="close-hit"
                  role="button"
                  aria-label={"Close " + document.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.closeDocument(document.id);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        <button className="sidebar-link" onClick={actions.openSettings}>Settings</button>
        <button className="sidebar-link" onClick={() => void actions.openLogs()}>Logs</button>
      </div>
    </aside>
  );
});
Sidebar.displayName = "Sidebar";
