import type { CSSProperties } from "react";
import { ViewerArea } from "../editor-area";
import type { ShellActions, ShellViewState } from "../types";
import "./native-preview-layout.css";

// A detached viewer is a small document window, not another workspace shell.
// macOS owns dragging, resizing and the window buttons across display edges.
export function NativePreviewLayout({ state, actions, style, theme }: {
  state: ShellViewState;
  actions: ShellActions;
  style: CSSProperties;
  theme: string;
}) {
  return <main className="app-shell native-preview-shell" data-runtime="tauri"
    data-theme={theme} data-effective-theme={theme} style={style}>
    <header className="native-preview-title" data-tauri-drag-region>
      <span data-tauri-drag-region>{state.activeDocument?.title ?? "Burette"}</span>
    </header>
    <section className="native-preview-content" aria-label="Molecule preview">
      <ViewerArea state={state} actions={actions} />
    </section>
  </main>;
}
