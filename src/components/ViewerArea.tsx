import { useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ViewerDocument } from "../types";
import type { ShellActions, ShellViewState } from "./types";
import { SettingsPage } from "./SettingsPage";

export function ViewerArea({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
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

  if (state.page === "settings") {
    return <SettingsPage state={state} actions={actions} />;
  }
  if (!state.activeDocument) {
    return <WelcomePanel actions={actions} />;
  }
  return <ViewerSurface document={state.activeDocument} />;
}

function ViewerSurface({ document }: { document: ViewerDocument }) {
  const url = convertFileSrc(document.runtimePath);
  return <iframe title={document.title} src={url} className="viewer-iframe" sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" />;
}

function WelcomePanel({ actions }: { actions: ShellActions }) {
  return (
    <div className="new-tab-page">
      <button onClick={actions.chooseFiles}>Open structure <kbd>⌘O</kbd></button>
      <button onClick={actions.focusSidebarSearch}>Search <kbd>⌘P</kbd></button>
    </div>
  );
}
