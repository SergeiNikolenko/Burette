import type { ShellActions, ShellViewState } from "../types";
import { pageKind } from "./page-kinds";

export function EditorTabs({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const activeTabIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  return (
    <div className="tab-strip" role="tablist" aria-label="Open structures" data-tauri-drag-region>
      <div className="tab-history-controls" data-tauri-drag-region>
        <button
          type="button"
          className="tab-history-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={actions.navigateBack}
          disabled={!actions.canNavigateBack}
          title="Back"
          aria-label="Back"
        >
          ←
        </button>
        <button
          type="button"
          className="tab-history-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={actions.navigateForward}
          disabled={!actions.canNavigateForward}
          title="Forward"
          aria-label="Forward"
        >
          →
        </button>
      </div>
      {state.tabs.map((tab, index) => {
        const kind = pageKind(tab.location);
        const title = kind.title(tab.location, state);
        const active = index === activeTabIndex;
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            className={active ? "tab active" : "tab"}
            onClick={() => actions.selectTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                actions.selectTab(tab.id);
              }
            }}
            title={tab.location.kind === "file" ? tab.location.path : title}
          >
            <span>{title}</span>
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
      <button className="new-tab" onClick={actions.openNewTab} title="New tab" aria-label="New tab">
        +
      </button>
      <div className="tab-strip-spacer" data-tauri-drag-region />
    </div>
  );
}
