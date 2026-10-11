import { useEffect } from "react";
import type { ShellActions, ShellViewState } from "../components/types";
import {
  dispatchWorkspaceHistoryCommand,
  isKetcherWorkspaceTarget,
} from "../lib/workspace-history-dispatch";
import { isTauriRuntime } from "../lib/tauri";
import { requestTextFind } from "../lib/text-find";
import { activateCommandHintTarget, watchCommandKeyHints } from "../lib/command-key-hints";
import { matchesAccelerator, resolveShortcutBindings, type ShortcutId } from "../lib/keyboard-shortcuts";
import { useAnnotationStore } from "../stores/annotation-store";
import { useSettingsStore } from "../stores/settings-store";
import { isAgentPluginSurface } from "../lib/native-mcp-workspace";
import { reopenClosedTab, toggleSidePanel } from "../components/workspace-panes/pane-actions";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function useKeyboardShortcuts(state: ShellViewState, actions: ShellActions, toggleSidebar: () => void, enabled = true) {
  const shortcutOverrides = useSettingsStore((store) => store.preferences.shortcutOverrides);
  useEffect(() => (enabled ? watchCommandKeyHints() : undefined), [enabled]);
  useEffect(() => {
    if (!enabled) return undefined;
    // Customizable bindings come from the shared registry plus Settings overrides.
    const bindings = resolveShortcutBindings(shortcutOverrides);
    const matches = (id: ShortcutId, event: KeyboardEvent) => matchesAccelerator(event, bindings[id]);
    const selectAdjacentTab = (offset: -1 | 1) => {
      if (state.tabs.length === 0) return;
      const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const currentIndex = activeIndex >= 0 ? activeIndex : 0;
      const nextIndex = (currentIndex + offset + state.tabs.length) % state.tabs.length;
      actions.selectTab(state.tabs[nextIndex].id);
    };
    // Browser runtime only: the desktop app receives these through native menu
    // accelerators, which Settings updates at runtime.
    const browserCommands: [ShortcutId, () => unknown][] = [
      ["window.next-tab", () => selectAdjacentTab(1)],
      ["window.previous-tab", () => selectAdjacentTab(-1)],
      ["file.open", () => actions.chooseFiles()],
      ["file.new-window", () => actions.openNewWindow()],
      ["file.new-tab", () => actions.openNewTab()],
      ["file.reveal-active", () => actions.revealActiveDocument()],
      ["file.copy-active-path", () => actions.copyActiveDocumentPath()],
      ["file.show-active-metadata", () => actions.showActiveDocumentMetadata()],
      ["file.export-preview-png", () => actions.exportActivePreviewAsPng()],
      ["file.export-preview-svg", () => actions.exportActivePreviewAsSvg()],
      ["view.navigate-back", () => actions.navigateBack()],
      ["view.navigate-forward", () => actions.navigateForward()],
      ["view.toggle-bottom-panel", () => actions.toggleDock("bottom")],
      ["view.toggle-sidebar", toggleSidebar],
      ["view.toggle-inspector", () => actions.toggleDock("right")],
      ["view.toggle-side-panel", toggleSidePanel],
      ["view.toggle-sidebar-browser", toggleSidebar],
      ["settings.open", () => actions.openSettings()],
      ["help.keyboard-shortcuts", () => actions.openSettingsSection("keyboard")],
      ["file.close-tab", () => actions.closeActiveDocument()],
      ["file.close-other-tabs", () => state.activeTabId && actions.closeOtherTabs(state.activeTabId)],
      ["file.reopen-closed-tab", () => reopenClosedTab(actions)],
    ];
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (matches("edit.find", event) && !event.defaultPrevented && requestTextFind()) {
        event.preventDefault();
        return;
      }
      if (matches("app.command-palette-quick", event) && !isEditableTarget(event.target)) {
        event.preventDefault();
        actions.openCommandPalette();
        return;
      }
      // Kept above the Tauri gate so the webview default (macOS print) is
      // suppressed even when the native menu accelerator owns the shortcut;
      // otherwise the print sheet steals focus and dismisses the palette.
      if (matches("view.command-palette", event)) {
        event.preventDefault();
        actions.openCommandPalette();
        return;
      }
      if (commandKey && !event.altKey && key === "p") {
        event.preventDefault();
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        if (activateCommandHintTarget(Number(event.key))) event.preventDefault();
        return;
      }
      // No native menu item owns this one, so the webview handles it everywhere.
      if (matches("file.open-most-recent", event)) {
        event.preventDefault();
        void actions.openMostRecentStructure();
        return;
      }
      if (isTauriRuntime()) return;
      if (commandKey && key === "z" && !event.altKey) {
        if (
          isEditableTarget(event.target) ||
          isKetcherWorkspaceTarget(event.target) ||
          state.activeTab?.location.kind === "ketcher"
        ) return;
        event.preventDefault();
        void dispatchWorkspaceHistoryCommand(event.shiftKey ? "redo" : "undo", actions);
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && event.key === "." && isAgentPluginSurface(state.buildInfo.isAgentShell)) {
        event.preventDefault();
        useAnnotationStore.getState().toggle();
        return;
      }
      for (const [id, run] of browserCommands) {
        if (!matches(id, event)) continue;
        event.preventDefault();
        void run();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, enabled, shortcutOverrides, state.activeTab?.location.kind, state.activeTabId, state.buildInfo.isAgentShell, state.tabs, toggleSidebar]);
}
