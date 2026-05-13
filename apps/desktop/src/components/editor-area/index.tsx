import { useEffect } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { NewTabPage } from "./new-tab-page";
import { pageKind } from "./page-kinds";

export function EditorArea({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; body?: { type?: string; value?: string } } | undefined;
      if (data?.source !== "burrete-viewer") return;
      const body = data.body;
      if (body?.type === "setRenderer") {
        const renderer = body.value;
        if (renderer === "auto" || renderer === "xyz-fast" || renderer === "molstar" || renderer === "xyzrender-external") {
          actions.setPreference("rendererMode", renderer);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [actions]);

  if (state.tabs.length === 0 || !state.activeTabId) {
    return (
      <div className="editor-area">
        <NewTabPage state={state} actions={actions} />
      </div>
    );
  }

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];

  return (
    <div className="editor-area">
      {state.tabs.map((tab) => {
        const kind = pageKind(tab);
        const isActive = tab.id === state.activeTabId;
        if (!kind.keepAlive && !isActive) return null;
        const Component = kind.Component;
        return (
          <Component
            key={tab.id}
            tab={tab}
            isActive={isActive}
            state={state}
            actions={actions}
          />
        );
      })}
      {state.activeTabId ? pageKind(activeTab).renderFooter?.(activeTab, state) : null}
    </div>
  );
}

export { EditorArea as ViewerArea };
