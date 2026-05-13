import type { ShellActions, ShellViewState } from "../types";

function Shortcut({ children }: { children: string }) {
  return <kbd>{children}</kbd>;
}

export function NewTabPage({ actions }: { state: ShellViewState; actions: ShellActions }) {
  return (
    <div className="new-tab-page">
      <div className="new-tab-content">
        <div className="new-tab-actions">
          <button type="button" onClick={() => actions.openCommandPalette("create-file")}>
            Create new structure
            <Shortcut>⌘N</Shortcut>
          </button>
          <button type="button" onClick={() => actions.openCommandPalette("search")}>
            Search
            <Shortcut>⌘O</Shortcut>
          </button>
        </div>
      </div>
    </div>
  );
}
