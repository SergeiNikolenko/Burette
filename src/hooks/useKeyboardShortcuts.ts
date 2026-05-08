import { useEffect } from "react";
import type { ShellActions, ShellViewState } from "../components/types";

export function useKeyboardShortcuts(state: ShellViewState, actions: ShellActions, toggleSidebar: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (commandKey && key === "o") {
        event.preventDefault();
        void actions.chooseFiles();
        return;
      }
      if (commandKey && key === "p") {
        event.preventDefault();
        actions.focusSidebarSearch();
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
        const document = state.documents[Number(event.key) - 1];
        if (document) {
          event.preventDefault();
          actions.selectDocument(document.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, state.documents, toggleSidebar]);
}
