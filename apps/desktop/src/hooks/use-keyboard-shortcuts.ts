import { useEffect } from "react";
import type { ShellActions, ShellViewState } from "../components/types";
import {
  dispatchWorkspaceHistoryCommand,
  isKetcherWorkspaceTarget,
} from "../lib/workspace-history-dispatch";
import { isTauriRuntime } from "../lib/tauri";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function useKeyboardShortcuts(state: ShellViewState, actions: ShellActions, toggleSidebar: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const selectAdjacentTab = (offset: -1 | 1) => {
        if (state.tabs.length === 0) return;
        const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
        const currentIndex = activeIndex >= 0 ? activeIndex : 0;
        const nextIndex = (currentIndex + offset + state.tabs.length) % state.tabs.length;
        actions.selectTab(state.tabs[nextIndex].id);
      };
      if (!commandKey && !event.altKey && key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        actions.openCommandPalette();
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const tab = state.tabs[Number(event.key) - 1];
        if (tab) {
          event.preventDefault();
          actions.selectTab(tab.id);
        }
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
      if (event.ctrlKey && !event.metaKey && !event.altKey && key === "tab") {
        event.preventDefault();
        selectAdjacentTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (commandKey && !event.altKey && key === "o") {
        event.preventDefault();
        if (event.shiftKey) {
          void actions.openMostRecentStructure();
        } else {
          void actions.chooseFiles();
        }
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && key === "n") {
        event.preventDefault();
        void actions.openNewWindow();
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && key === "t") {
        event.preventDefault();
        actions.openNewTab();
        return;
      }
      if (commandKey && !event.altKey && event.shiftKey && key === "r") {
        event.preventDefault();
        void actions.revealActiveDocument();
        return;
      }
      if (commandKey && !event.altKey && event.shiftKey && key === "c") {
        event.preventDefault();
        void actions.copyActiveDocumentPath();
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && key === "i") {
        event.preventDefault();
        void actions.showActiveDocumentMetadata();
        return;
      }
      if (commandKey && key === "e" && event.altKey !== event.shiftKey) {
        event.preventDefault();
        if (event.altKey) {
          void actions.exportActivePreviewAsSvg();
        } else {
          void actions.exportActivePreviewAsPng();
        }
        return;
      }
      if (commandKey && !event.altKey && key === "p") {
        event.preventDefault();
        actions.openCommandPalette();
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && key === "j") {
        event.preventDefault();
        actions.toggleDock("bottom");
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && key === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (commandKey && event.altKey && !event.shiftKey && key === "b") {
        event.preventDefault();
        actions.toggleDock("right");
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && event.key === "\\") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && key === ",") {
        event.preventDefault();
        actions.openSettings();
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && key === "w") {
        event.preventDefault();
        actions.closeActiveDocument();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, enabled, state.activeTabId, state.tabs, toggleSidebar]);
}
