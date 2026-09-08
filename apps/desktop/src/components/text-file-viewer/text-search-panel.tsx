import { useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, searchPanelOpen, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView, Panel } from "@codemirror/view";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../ui/input-group";
import { ChevronUp, ChevronDown, Search, X } from "../ui/app-icons";

export function toggleTextSearch(view: EditorView) {
  return searchPanelOpen(view.state) ? closeSearchPanel(view) : openSearchPanel(view);
}

function TextSearchPanel({ view, state }: { view: EditorView; state: EditorState }) {
  const query = getSearchQuery(state);
  const matches = useMemo(() => {
    const ranges: Array<{ from: number; to: number }> = [];
    if (query.valid) {
      const cursor = query.getCursor(state.doc);
      for (let match = cursor.next(); !match.done && ranges.length <= 10_000; match = cursor.next()) ranges.push(match.value);
    }
    return ranges;
  }, [query, state.doc]);
  const currentIndex = matches.findIndex((match) => match.from === state.selection.main.from && match.to === state.selection.main.to) + 1;
  const current = currentIndex > 10_000 || (!currentIndex && matches.length > 10_000 && state.selection.main.from >= matches[10_000].from) ? "10,000+" : String(currentIndex);
  const count = matches.length > 10_000 ? "10,000+" : String(matches.length);
  return (
    <div className="flex items-center gap-1 bg-background p-2" role="search" aria-label="Find in text" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") toggleTextSearch(view);
      else if (event.key === "Escape") closeSearchPanel(view);
      else if (event.key === "Enter" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g")) {
        (event.shiftKey ? findPrevious : findNext)(view);
      } else return;
      event.preventDefault();
      event.stopPropagation();
    }}>
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput
          aria-label="Find in text"
          placeholder="Find in text…"
          autoFocus
          {...{ "main-field": "true" }}
          value={query.search}
          onChange={(event) => {
            view.dispatch({
              effects: setSearchQuery.of(new SearchQuery({ ...query, search: event.target.value })),
              selection: EditorSelection.cursor(view.state.selection.main.from),
            });
            if (event.target.value) findNext(view);
          }}
        />
        {query.search ? <InputGroupAddon align="inline-end"><InputGroupText role="status" aria-live="polite">{current} / {count}</InputGroupText></InputGroupAddon> : null}
      </InputGroup>
      <Button variant="ghost" size="icon-xs" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!matches.length} onClick={() => findPrevious(view)}><ChevronUp /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Next match" title="Next match (Enter)" disabled={!matches.length} onClick={() => findNext(view)}><ChevronDown /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Close text search" title="Close (⌘F or Esc)" onClick={() => closeSearchPanel(view)}><X /></Button>
    </div>
  );
}

export function createTextSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  let root: Root | null = null;
  const render = () => root?.render(<TextSearchPanel view={view} state={view.state} />);
  return {
    dom,
    top: true,
    mount() { root = createRoot(dom); render(); },
    update(update) {
      if (update.docChanged || update.selectionSet || getSearchQuery(update.startState) !== getSearchQuery(update.state)) render();
    },
    destroy() {
      const previous = root;
      root = null;
      // A viewer can be destroyed by React itself while another root commits.
      queueMicrotask(() => previous?.unmount());
    },
  };
}
