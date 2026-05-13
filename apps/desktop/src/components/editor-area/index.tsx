import type { ComponentType } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { pageKind, type Location } from "./page-kinds";
import type { PageComponentProps } from "./page-kinds/types";

export function ViewerArea({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const activeTabId = state.activeTabId ?? state.activeTab?.id;
  const tabs = state.tabs.length > 0 ? state.tabs : [{ id: "fallback", location: activeLocation(state), back: [], forward: [] }];
  const activeTabIndex = tabs.findIndex((tab) => tab.id === activeTabId);

  return (
    <div className="page-stack">
      {tabs.map((tab, index) => {
        const kind = pageKind(tab.location);
        const isActive = index === activeTabIndex;
        if (!kind.keepAlive && !isActive) return null;
        const Page = kind.Component as ComponentType<PageComponentProps<typeof tab.location>>;
        return (
          <div key={tab.id} className="page-surface" data-page-kind={kind.kind} data-active={isActive || undefined} aria-hidden={!isActive}>
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
