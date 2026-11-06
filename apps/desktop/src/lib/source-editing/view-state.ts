import type { EditorView } from "@codemirror/view";

export type SourceEditorViewState = { anchor: number; head: number; scrollTop: number; scrollLeft: number };
const editors = new Map<string, Set<EditorView>>();

export function registerSourceEditor(path: string, view: EditorView) {
  const views = editors.get(path) ?? new Set<EditorView>();
  views.add(view);
  editors.set(path, views);
  return () => {
    views.delete(view);
    if (!views.size) editors.delete(path);
  };
}

export function captureSourceEditorView(path: string): SourceEditorViewState | undefined {
  const views = [...(editors.get(path) ?? [])];
  const view = views.find(candidate => candidate.hasFocus) ?? views.at(-1);
  if (!view) return undefined;
  const { anchor, head } = view.state.selection.main;
  return { anchor, head, scrollTop: view.scrollDOM.scrollTop, scrollLeft: view.scrollDOM.scrollLeft };
}

export function restoreSourceEditorView(view: EditorView, state: SourceEditorViewState) {
  const position = (value: number) => Math.min(view.state.doc.length, Math.max(0, value));
  view.dispatch({ selection: { anchor: position(state.anchor), head: position(state.head) } });
  view.scrollDOM.scrollTop = state.scrollTop;
  view.scrollDOM.scrollLeft = state.scrollLeft;
}
