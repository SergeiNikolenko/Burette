import type { ShellActions } from "../types";

export function WelcomeScreen({ actions }: { actions: ShellActions }) {
  return (
    <div className="writer-welcome">
      <div className="writer-welcome-content">
        <p>Add a folder with molecular structures or open a structure file.</p>

        <div className="writer-welcome-actions">
          <button
            type="button"
            onClick={() => void actions.chooseFolder()}
            className="writer-primary-button"
          >
            Add Folder
          </button>
          <button
            type="button"
            onClick={() => void actions.chooseFiles()}
            className="writer-secondary-button"
          >
            Open File
          </button>
        </div>
      </div>
    </div>
  );
}
