import { ScrollFade } from "../scroll-fade";
import { copyText, relativePath } from "../context-menu";
import type { ShellActions, ShellViewState } from "../types";
import { buildTabMenuItemsSpec, showNativeContextMenu } from "./editor-context-menu";
import { useScrollActiveTabIntoView } from "../../hooks/use-scroll-active-tab-into-view";

function handleKeyboardSelect(event: React.KeyboardEvent<HTMLElement>, onSelect: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelect();
}

function handleTabKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  tabId: string,
  state: ShellViewState,
  actions: ShellActions,
) {
  const currentIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (currentIndex < 0) return;

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + state.tabs.length) % state.tabs.length;
    actions.selectTab(state.tabs[nextIndex].id);
    return;
  }

  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const nextTab = event.key === "Home" ? state.tabs[0] : state.tabs[state.tabs.length - 1];
    if (nextTab) actions.selectTab(nextTab.id);
    return;
  }

  if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    actions.closeTab(tabId);
    return;
  }

  handleKeyboardSelect(event, () => actions.selectTab(tabId));
}

export function EditorTabs({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  useScrollActiveTabIntoView(state.activeTabId);

  return (
    <div className="editor-tabs" data-tauri-drag-region>
      <div className="history-cluster">
        <button type="button" className="history-button" disabled={!state.canNavigateBack} onClick={actions.navigateBack} aria-label="Back" data-no-window-drag>←</button>
        <button type="button" className="history-button" disabled={!state.canNavigateForward} onClick={actions.navigateForward} aria-label="Forward" data-no-window-drag>→</button>
      </div>
      <div className="tab-strip" role="tablist" aria-label="Open tabs" data-tauri-drag-region>
        <ScrollFade
          axis="horizontal"
          className="tab-strip-inner"
          data-tab-strip
          data-tauri-drag-region
        >
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              data-no-window-drag
              role="tab"
              tabIndex={tab.id === state.activeTabId ? 0 : -1}
              aria-selected={tab.id === state.activeTabId}
              className={tab.id === state.activeTabId ? "tab active" : "tab"}
              onClick={() => actions.selectTab(tab.id)}
              onContextMenu={(event) => {
                if (tab.kind !== "document") return;
                const document = tab.document;
                event.preventDefault();
                void showNativeContextMenu(
                  buildTabMenuItemsSpec({
                    onClose: () => actions.closeTab(tab.id),
                    onCloseOthers: () => {
                      for (const candidate of state.tabs) {
                        if (candidate.id !== tab.id) actions.closeTab(candidate.id);
                      }
                    },
                    onCloseAll: () => {
                      for (const candidate of state.tabs) actions.closeTab(candidate.id);
                    },
                    onRevealInSidebar: () => actions.selectTab(tab.id),
                    onCopyPath: () => {
                      void copyText(relativePath(document.path, state.workspaceRoot));
                    },
                  }),
                );
              }}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id, state, actions)}
              title={tab.kind === "document" ? tab.document.path : tab.title}
            >
              {tab.kind === "document" && tab.loadState !== "ready" ? (
                <span
                  className={tab.loadState === "error" ? "tab-status error" : "tab-status loading"}
                  aria-label={tab.loadState === "error" ? "Load failed" : "Loading"}
                />
              ) : null}
              <span>{tab.title}</span>
              <div className="tab-close-wrap">
                <button
                  type="button"
                  className="tab-close"
                  data-no-window-drag
                  aria-label={"Close " + tab.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.closeTab(tab.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </ScrollFade>
        <button type="button" className="new-tab" onClick={actions.openLauncher} title="New tab" aria-label="New tab" data-no-window-drag>+</button>
      </div>
    </div>
  );
}
