import { useEffect, useRef } from "react";
import type { ShellActions, ShellViewState } from "../components/types";

function isEditableTargetFocused() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
  if (active.isContentEditable) return true;
  return active.closest(".cm-editor") !== null;
}

export function useKeyboardShortcuts(state: ShellViewState, actions: ShellActions) {
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);
  stateRef.current = state;
  actionsRef.current = actions;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = stateRef.current;
      const actions = actionsRef.current;
      const commandKey = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (event.key === "Escape" && state.commandPaletteOpen) {
        event.preventDefault();
        actions.closeCommandPalette();
        return;
      }
      if (!isEditableTargetFocused() && event.altKey && !event.metaKey && !event.ctrlKey) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          actions.navigateBack();
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          actions.navigateForward();
          return;
        }
      }
      if (event.ctrlKey && !event.metaKey && event.key === "Tab") {
        event.preventDefault();
        actions.cycleDocument(event.shiftKey ? -1 : 1);
        return;
      }
      if (commandKey && key >= "1" && key <= "9") {
        const tab = state.tabs[Number(key) - 1];
        if (tab) {
          event.preventDefault();
          actions.selectTab(tab.id);
        }
        return;
      }
      if (isEditableTargetFocused() && !(commandKey && (key === "o" || key === "p" || key === ","))) {
        return;
      }
      if (commandKey && key === "o") {
        event.preventDefault();
        if (state.workspaceRoot) actions.openCommandPalette("search");
        return;
      }
      if (commandKey && key === "p") {
        event.preventDefault();
        if (event.shiftKey || state.workspaceRoot) actions.openCommandPalette("search");
        return;
      }
      if (commandKey && key === "n") {
        event.preventDefault();
        if (state.workspaceRoot) actions.openCommandPalette("create-file");
        return;
      }
      if (commandKey && key === "t") {
        event.preventDefault();
        if (state.workspaceRoot) actions.openLauncher();
        return;
      }
      if (commandKey && event.key === "\\") {
        event.preventDefault();
        actions.toggleSidebar();
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
