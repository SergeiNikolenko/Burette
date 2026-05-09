import type { ShellActions, ShellViewState } from "./types";

export function EditorTabs({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  return (
    <div className="tab-strip">
      {state.documents.map((document) => (
        <button
          key={document.id}
          className={state.page === "viewer" && document.id === state.activeDocumentId ? "tab active" : "tab"}
          onClick={() => actions.selectDocument(document.id)}
          title={document.path}
        >
          <span>{document.title}</span>
        </button>
      ))}
      {state.page === "settings" && (
        <button className="tab active utility-tab" onClick={actions.openSettings}>
          <span>Settings</span>
        </button>
      )}
      <button className="new-tab" onClick={actions.chooseFiles} title="Open structure" aria-label="Open structure">+</button>
    </div>
  );
}
