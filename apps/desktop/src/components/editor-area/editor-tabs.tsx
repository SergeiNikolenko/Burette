import type { ShellActions, ShellViewState } from "../types";
import { ScrollFade } from "../scroll-fade";
import { writeStructureDrag } from "../../lib/structure-drag";
import { pageKind } from "./page-kinds";

export function EditorTabs({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const activeTabIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  return (
    <div className="tab-strip" data-tauri-drag-region>
      <div className="tab-history-controls">
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
      <ScrollFade axis="horizontal" className="tab-scroll-region" role="tablist" aria-label="Open structures" data-tauri-drag-region>
        {state.tabs.map((tab, index) => {
          const kind = pageKind(tab.location);
          const title = kind.title(tab.location, state);
          const active = index === activeTabIndex;
          const tabPath = tab.location.kind === "file" ? tab.location.path : null;
          return (
            <div key={tab.id} className="tab-shell" data-active={active || undefined}>
              <button
                type="button"
                role="tab"
                draggable={Boolean(tabPath)}
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                className={active ? "tab active" : "tab"}
                onClick={() => actions.selectTab(tab.id)}
                onDragStart={(event) => {
                  if (!tabPath) return;
                  writeStructureDrag(event.dataTransfer, [tabPath]);
                  actions.setStructureDragActive(true);
                }}
                onDragEnd={() => actions.setStructureDragActive(false)}
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
                title={tabPath ?? title}
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
      </ScrollFade>
      <button type="button" className="new-tab" onClick={actions.openNewTab} title="New tab" aria-label="New tab">
        +
      </button>
      <div className="tab-strip-spacer" data-tauri-drag-region />
    </div>
  );
}
