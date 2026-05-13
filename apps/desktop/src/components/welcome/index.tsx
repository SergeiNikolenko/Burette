import type { ShellActions } from "../types";

export function WelcomeScreen({ actions }: { actions: ShellActions }) {
  return (
    <div className="new-tab-page">
      <div className="new-tab-actions">
        <button onClick={actions.chooseFiles}>Open structure <kbd>⌘O</kbd></button>
        <button onClick={actions.openCommandPalette}>Command Palette <kbd>⌘P</kbd></button>
      </div>
    </div>
  );
}
