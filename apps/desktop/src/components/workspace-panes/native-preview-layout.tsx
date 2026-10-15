import { Button } from "../ui/button";
import { RadixDropdownMenu } from "../radix-menu";
import { TabKindIcon } from "../editor-area/tab-kind-icon";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, Expand, Minus } from "../ui/app-icons";
import { ToolbarButton } from "../ui/toolbar-button";
import "./workspace-panes.css";
import { buildThemeStyle, resolveThemeMode, useSystemThemeMode } from "../../lib/theme";
import { ViewerArea } from "../editor-area";
import type { ShellActions, ShellViewState } from "../types";
import "./native-preview-layout.css";

// A detached viewer is a small document window, not another workspace shell.
// macOS owns dragging, resizing and the window buttons across display edges.
export function NativePreviewLayout({ state, actions }: {
  state: ShellViewState;
  actions: ShellActions;
}) {
  const systemTheme = useSystemThemeMode();
  const theme = resolveThemeMode(state.preferences.theme, systemTheme);
  const style = buildThemeStyle(state.preferences, systemTheme);
  return <main className="app-shell native-preview-shell" data-runtime="tauri"
    data-theme={theme} data-effective-theme={theme} style={style}>
    <header className="floating-pane-header native-preview-title" data-tauri-drag-region>
      <ToolbarButton aria-label="Minimize" onClick={() => void getCurrentWindow().minimize()}><Minus size={16} aria-hidden /></ToolbarButton>
      <div className="floating-pane-title" data-tauri-drag-region>
        <RadixDropdownMenu items={[
          { kind: "item", id: "preview-open", text: "Open…", action: () => actions.chooseFiles() },
          { kind: "item", id: "preview-close", text: "Close", action: () => getCurrentWindow().close() },
        ]} trigger={<Button variant="ghost" size="toolbar" className="pane-switcher" aria-label="Molecule menu">
          {state.activeTab ? <span className="pane-switcher-icon" aria-hidden><TabKindIcon location={state.activeTab.location} state={state} /></span> : null}
          <span className="pane-switcher-title">{state.activeDocument?.title ?? "Burette"}</span>
          <ChevronDown size={12} aria-hidden />
        </Button>} />
      </div>
      <ToolbarButton aria-label="Expand" onClick={() => void getCurrentWindow().toggleMaximize()}><Expand size={16} aria-hidden /></ToolbarButton>
      <span className="floating-pane-grip" aria-hidden data-tauri-drag-region />
    </header>
    <section className="native-preview-content" aria-label="Molecule preview">
      <ViewerArea state={state} actions={actions} />
    </section>
  </main>;
}
