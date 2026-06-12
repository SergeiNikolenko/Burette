import { useRef, type KeyboardEvent } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { pageKind } from "./page-kinds";

export function EditorTabs({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const tabRefs = useRef<Array<HTMLDivElement | null>>([]);

  const selectTabByOffset = (index: number, offset: number) => {
    const tabCount = state.tabs.length;
    const nextIndex = (index + offset + tabCount) % tabCount;
    const nextTab = state.tabs[nextIndex];
    actions.selectTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number, tabId: string) => {
    if (event.currentTarget !== event.target) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      actions.selectTab(tabId);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      selectTabByOffset(index, event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  return (
    <div className="tab-strip" role="tablist" aria-label="Open structures">
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
        const active = tab.id === state.activeTabId;
        return (
          <div
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            className={active ? "tab active" : "tab"}
            onClick={() => actions.selectTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index, tab.id)}
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
