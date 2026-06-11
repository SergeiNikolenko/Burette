import { useEffect } from "react";
import type { ShellActions, ShellViewState } from "../components/types";

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
      if (!commandKey && !event.altKey && key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        actions.openCommandPalette();
        return;
      }
      if (commandKey && key === "o") {
        event.preventDefault();
        if (event.shiftKey) {
          void actions.openMostRecentStructure();
        } else {
          void actions.chooseFiles();
        }
        return;
      }
      if (commandKey && event.shiftKey && key === "r") {
        event.preventDefault();
        void actions.revealActiveDocument();
        return;
      }
      if (commandKey && event.shiftKey && key === "c") {
        event.preventDefault();
        void actions.copyActiveDocumentPath();
        return;
      }
      if (commandKey && key === "i") {
        event.preventDefault();
        void actions.showActiveDocumentMetadata();
        return;
      }
      if (commandKey && key === "e" && (event.shiftKey || event.altKey)) {
        event.preventDefault();
        if (event.altKey) {
          void actions.exportActivePreviewAsSvg();
        } else {
          void actions.exportActivePreviewAsPng();
        }
        return;
      }
      if (commandKey && key === "p") {
        event.preventDefault();
        actions.openCommandPalette();
        return;
      }
      if (commandKey && key === "j") {
        event.preventDefault();
        actions.toggleDock("bottom");
        return;
      }
      if (commandKey && !event.altKey && !event.shiftKey && key === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (commandKey && event.altKey && key === "b") {
        event.preventDefault();
        actions.toggleDock("right");
        return;
      }
      if (commandKey && event.key === "\\") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (commandKey && key === ",") {
        event.preventDefault();
        actions.openSettings();
        return;
      }
      if (commandKey && key === "w") {
        event.preventDefault();
        actions.closeActiveDocument();
        return;
      }
      if (commandKey && /^[1-9]$/.test(event.key)) {
        const tab = state.tabs[Number(event.key) - 1];
        if (tab) {
          event.preventDefault();
          actions.selectTab(tab.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, enabled, state.tabs, toggleSidebar]);
}
