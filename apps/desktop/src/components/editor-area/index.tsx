import type { ComponentType } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { pageKind, type Location } from "./page-kinds";
import type { PageComponentProps } from "./page-kinds/types";

export function ViewerArea({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const activeTabId = state.activeTab?.id ?? state.activeTabId;
  const tabs = state.tabs.length > 0 ? state.tabs : [{ id: "fallback", location: activeLocation(state), back: [], forward: [] }];

  return (
    <div className="page-stack">
      {tabs.map((tab) => {
        const kind = pageKind(tab.location);
        const isActive = tab.id === activeTabId;
        if (!kind.keepAlive && !isActive) return null;
        const Page = kind.Component as ComponentType<PageComponentProps<typeof tab.location>>;
        return (
          <div key={tab.id} className="page-surface" data-active={isActive || undefined} aria-hidden={!isActive}>
            <Page location={tab.location} state={state} actions={actions} isActive={isActive} />
          </div>
        );
      })}
    </div>
  );
}

function activeLocation(state: ShellViewState): Location {
  if (state.page === "settings") {
    return { kind: "settings" };
  }
  if (state.activeDocument) {
    return { kind: "file", documentId: state.activeDocument.id, path: state.activeDocument.path };
  }
  return { kind: "launcher" };
}
