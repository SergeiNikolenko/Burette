import type { ShellActions } from "../types";

export function WelcomeScreen({ actions }: { actions: ShellActions }) {
  return (
    <div className="new-tab-page">
      <div className="new-tab-copy">
        <p className="new-tab-eyebrow">Burrete Desktop</p>
        <h1>Open a molecular structure</h1>
        <p className="new-tab-description">
          Use the shell to inspect files quickly, switch renderers when needed, and return to recent structures without leaving the workspace.
        </p>
      </div>
      <div className="new-tab-actions">
        <button type="button" className="welcome-primary" onClick={() => void actions.chooseFiles()}>
          Open Structure <kbd>⌘O</kbd>
        </button>
        <button type="button" onClick={actions.openCommandPalette}>Command Palette <kbd>⌘P</kbd> <kbd>/</kbd></button>
        <button type="button" onClick={actions.openSettings}>Settings <kbd>⌘,</kbd></button>
      </div>
    </div>
  );
}
