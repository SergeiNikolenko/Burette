import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { ScrollFade } from "../scroll-fade";
import type { ShellActions, ShellViewState } from "../types";
import { FileTree } from "./file-tree";

export function FileBrowser({
  state,
  actions,
}: {
  state: ShellViewState;
  actions: ShellActions;
}) {
  if (!state.workspaceRoot) {
    return (
      <div className="sidebar-browser">
        <ScrollFade className="sidebar-scroll">
          <div className="empty-sidebar">No folder open</div>
        </ScrollFade>
      </div>
    );
  }

  return (
    <div className="sidebar-browser">
      <div className="sidebar-search-wrap">
        <button
          type="button"
          className="sidebar-search-row"
          onClick={() => actions.openCommandPalette()}
        >
          <span className="search-icon" aria-hidden="true">
            <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
          </span>
          <span>Search</span>
          <kbd>
            ⌘<span>P</span>
          </kbd>
        </button>
      </div>
      <ScrollFade className="sidebar-scroll">
        <FileTree state={state} actions={actions} />
      </ScrollFade>
    </div>
  );
}
