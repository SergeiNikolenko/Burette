import type { ShellActions, ShellViewState } from "../types";
import { pageKind } from "./page-kinds";

export function EditorTabs({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const activeTabIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  return (
    <div className="tab-strip" role="tablist" aria-label="Open structures">
      {state.tabs.map((tab, index) => {
        const kind = pageKind(tab.location);
        const title = kind.title(tab.location, state);
        const active = index === activeTabIndex;
        return (
          <div key={tab.id} className="tab-shell" data-active={active || undefined}>
            <button
              type="button"
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              className={active ? "tab active" : "tab"}
              onClick={() => actions.selectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  actions.selectTab(tab.id);
                  return;
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  const next = state.tabs[(index + 1) % state.tabs.length];
                  if (next) actions.selectTab(next.id);
                  return;
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  const next = state.tabs[(index - 1 + state.tabs.length) % state.tabs.length];
                  if (next) actions.selectTab(next.id);
                  return;
                }
                if (event.key === "Home") {
                  event.preventDefault();
                  const next = state.tabs[0];
                  if (next) actions.selectTab(next.id);
                  return;
                }
                if (event.key === "End") {
                  event.preventDefault();
                  const next = state.tabs[state.tabs.length - 1];
                  if (next) actions.selectTab(next.id);
                }
              }}
              title={tab.location.kind === "file" ? tab.location.path : title}
            >
              <span>{title}</span>
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={"Close " + title}
              onClick={(event) => {
                event.stopPropagation();
                actions.closeTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button type="button" className="new-tab" onClick={actions.openNewTab} title="New tab" aria-label="New tab">
        +
      </button>
      <div className="tab-strip-spacer" data-tauri-drag-region />
    </div>
  );
}
