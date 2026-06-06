import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type SelectionRange,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "@prosemark/core";
import { MERMAID_CANVAS_HEIGHT, mountMermaidCanvas } from "./markdown-mermaid-canvas";
import { renderMermaid } from "./markdown-mermaid-renderer";

const WIDGET_VERTICAL_PADDING = 16;

class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly editMode: boolean,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return this.source === other.source && this.editMode === other.editMode;
  }

  get estimatedHeight(): number {
    return MERMAID_CANVAS_HEIGHT + WIDGET_VERTICAL_PADDING;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-mermaid-widget";
    wrapper.contentEditable = "false";

    const host = document.createElement("div");
    host.className = "cm-mermaid-canvas";
    host.tabIndex = 0;
    wrapper.append(host);

    const result = renderMermaid(this.source);
    if (result.svg) {
      mountMermaidCanvas(host, {
        svgHtml: result.svg,
        ariaLabel: `Mermaid diagram: ${this.source.split("\n")[0]}`,
        editMode: this.editMode,
        onToggleEdit: () => toggleEditMode(view, host, this.editMode),
      });
    } else if (result.error) {
      host.classList.add("cm-mermaid-error");
      host.textContent = `Diagram error: ${result.error}`;
    }

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function computeToggleSelection(
  editMode: boolean,
  fenceFrom: number,
  fenceTo: number,
  docLength: number,
): { anchor: number; head?: number } {
  if (editMode) return { anchor: Math.min(fenceTo + 1, docLength) };
  return { anchor: fenceTo, head: fenceFrom };
}

function findEnclosingFencedCode(view: EditorView, host: HTMLElement) {
  const pos = view.posAtDOM(host);
  const tree = syntaxTree(view.state);
  for (const side of [-1, 1] as const) {
    let node = tree.resolveInner(pos, side);
    while (node.name !== "FencedCode" && node.parent) node = node.parent;
    if (node.name === "FencedCode") return node;
  }
  return null;
}

function toggleEditMode(view: EditorView, host: HTMLElement, editMode: boolean): void {
  const fence = findEnclosingFencedCode(view, host);
  if (!fence) return;

  const selection = computeToggleSelection(editMode, fence.from, fence.to, view.state.doc.length);
  view.dispatch({
    selection:
      selection.head !== undefined
        ? EditorSelection.single(selection.anchor, selection.head)
        : { anchor: selection.anchor },
    effects: view.scrollSnapshot(),
  });
  view.contentDOM.focus({ preventScroll: true });
}

function parseFencedCode(
  state: { doc: { sliceString(from: number, to: number): string } },
  node: {
    node: {
      firstChild: {
        name: string;
        from: number;
        to: number;
        nextSibling: typeof node.node.firstChild;
      } | null;
    };
  },
): { info: string; source: string } | undefined {
  let info = "";
  let source = "";

  let child = node.node.firstChild;
  while (child) {
    if (child.name === "CodeInfo") {
      info = state.doc.sliceString(child.from, child.to);
    } else if (child.name === "CodeText") {
      source += state.doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }

  if (!info) return undefined;
  return { info, source };
}

const startDragEffect = StateEffect.define<readonly SelectionRange[]>();
const endDragEffect = StateEffect.define<null>();

const dragFrozenSelectionField = StateField.define<readonly SelectionRange[] | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(startDragEffect)) return effect.value;
      if (effect.is(endDragEffect)) return null;
    }
    if (value && tr.docChanged) return value.map((range) => range.map(tr.changes));
    return value;
  },
});

function rangesTouchInclusive(ranges: readonly SelectionRange[], node: { from: number; to: number }) {
  return ranges.some((range) => range.from <= node.to && node.from <= range.to);
}

const DRAG_END_USER_EVENT = "select.pointer.drag-end";

function shouldStartDragGate(
  state: EditorState,
  event: { isPrimary: boolean; button: number; target: EventTarget | null },
): { effects: StateEffect<readonly SelectionRange[]> } | null {
  if (!event.isPrimary || event.button !== 0) return null;
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  if (target && typeof target.closest === "function" && target.closest(".cm-mermaid-widget")) {
    return null;
  }
  if (state.field(dragFrozenSelectionField, false) !== null) return null;
  return { effects: startDragEffect.of(state.selection.ranges) };
}

function buildEndDragDispatch(state: EditorState): {
  selection: typeof state.selection;
  effects: StateEffect<null>;
  userEvent: string;
} | null {
  if (state.field(dragFrozenSelectionField, false) === null) return null;
  return {
    selection: state.selection,
    effects: endDragEffect.of(null),
    userEvent: DRAG_END_USER_EVENT,
  };
}

const dragSelectionPlugin = ViewPlugin.fromClass(
  class {
    private readonly onWindowPointerUp: () => void;
    private readonly onWindowPointerCancel: () => void;
    private readonly onContentPointerDown: (event: PointerEvent) => void;
    private readonly onContentBlur: () => void;

    constructor(private readonly view: EditorView) {
      this.onContentPointerDown = (event: PointerEvent) => {
        const dispatch = shouldStartDragGate(this.view.state, event);
        if (dispatch) this.view.dispatch(dispatch);
      };
      this.onWindowPointerUp = () => this.endDrag();
      this.onWindowPointerCancel = () => this.endDrag();
      this.onContentBlur = () => this.endDrag();

      this.view.contentDOM.addEventListener("pointerdown", this.onContentPointerDown);
      this.view.contentDOM.addEventListener("blur", this.onContentBlur);
      window.addEventListener("pointerup", this.onWindowPointerUp);
      window.addEventListener("pointercancel", this.onWindowPointerCancel);
    }

    private endDrag(): void {
      const dispatch = buildEndDragDispatch(this.view.state);
      if (!dispatch) return;
      this.view.dispatch({
        selection: dispatch.selection,
        effects: dispatch.effects,
        annotations: Transaction.userEvent.of(dispatch.userEvent),
      });
    }

    destroy(): void {
      this.view.contentDOM.removeEventListener("pointerdown", this.onContentPointerDown);
      this.view.contentDOM.removeEventListener("blur", this.onContentBlur);
      window.removeEventListener("pointerup", this.onWindowPointerUp);
      window.removeEventListener("pointercancel", this.onWindowPointerCancel);
    }
  },
);

const mermaidFoldExtension = foldableSyntaxFacet.of({
  nodePath: "FencedCode",
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node, selectionTouchesRange) => {
    const parsed = parseFencedCode(state, node);
    if (!parsed) return undefined;
    if (!parsed.info.trim().toLowerCase().startsWith("mermaid")) return undefined;

    const source = parsed.source.trim();
    if (!source) return undefined;

    const frozen = state.field(dragFrozenSelectionField, false);
    const editMode = frozen ? rangesTouchInclusive(frozen, node) : selectionTouchesRange;
    const widget = new MermaidWidget(source, editMode);

    if (editMode) return Decoration.widget({ widget, block: true }).range(node.to);
    return Decoration.replace({ widget, block: true, inclusiveStart: true }).range(
      node.from,
      node.to,
    );
  },
});

const mermaidTheme = EditorView.baseTheme({
  ".cm-mermaid-widget": { padding: `${WIDGET_VERTICAL_PADDING / 2}px 0` },
  ".cm-mermaid-canvas": {
    position: "relative",
    height: `${MERMAID_CANVAS_HEIGHT}px`,
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    backgroundColor: "transparent",
    overflow: "hidden",
    outline: "none",
  },
  ".cm-mermaid-canvas:focus-visible": {
    outline: "2px solid var(--accent)",
    outlineOffset: "-2px",
  },
  ".cm-mermaid-canvas-viewport": {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
  },
  ".cm-mermaid-canvas-viewport.is-dragging": { cursor: "grabbing" },
  ".cm-mermaid-canvas-stage": {
    position: "absolute",
    top: "0",
    left: "0",
    transformOrigin: "0 0",
  },
  ".cm-mermaid-canvas-stage svg": { display: "block", maxWidth: "none" },
  ".cm-mermaid-canvas-stage svg[data-xychart-colors]": {
    "--xychart-color-1": "color-mix(in srgb, var(--accent) 45%, var(--fg-base) 55%)",
    "--xychart-color-2": "color-mix(in srgb, var(--accent) 20%, var(--fg-base) 80%)",
    "--xychart-color-3": "color-mix(in srgb, var(--accent) 8%, var(--fg-base) 92%)",
    "--xychart-color-4": "color-mix(in srgb, var(--accent) 4%, var(--fg-base) 96%)",
    "--xychart-color-5": "color-mix(in srgb, var(--accent) 2%, var(--fg-base) 98%)",
    "--xychart-color-6": "var(--fg-base)",
    "--xychart-color-7": "var(--fg-base)",
  },
  ".cm-mermaid-canvas-edit, .cm-mermaid-canvas-zoom-btn": {
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    backgroundColor: "var(--surface-card)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    font: "inherit",
    lineHeight: "1",
    opacity: "0",
    transition: "opacity 120ms ease-out, background-color 120ms ease-out, color 120ms ease-out",
  },
  ".cm-mermaid-canvas:hover .cm-mermaid-canvas-edit, .cm-mermaid-canvas:focus-within .cm-mermaid-canvas-edit, .cm-mermaid-canvas:hover .cm-mermaid-canvas-zoom-btn, .cm-mermaid-canvas:focus-within .cm-mermaid-canvas-zoom-btn":
    { opacity: "1" },
  ".cm-mermaid-canvas-edit:hover, .cm-mermaid-canvas-zoom-btn:hover": {
    backgroundColor: "var(--surface-subtle)",
    color: "var(--text-primary)",
  },
  ".cm-mermaid-canvas-edit": {
    position: "absolute",
    top: "8px",
    right: "8px",
    padding: "5px 10px",
    fontSize: "12px",
  },
  ".cm-mermaid-canvas-zoom": {
    position: "absolute",
    bottom: "8px",
    right: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  ".cm-mermaid-canvas-zoom-btn": {
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    padding: "0",
  },
  ".cm-mermaid-canvas.cm-mermaid-error": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.5em 1em",
    color: "var(--text-error, #ff6b6b)",
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
    fontSize: "0.85em",
    textAlign: "center",
  },
});

const foldTreeSync = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.state) !== syntaxTree(update.startState)) {
        setTimeout(() => {
          update.view.dispatch({ selection: update.view.state.selection });
        });
      }
    }
  },
);

export function markdownMermaidDecorations() {
  return [
    dragFrozenSelectionField,
    dragSelectionPlugin,
    mermaidFoldExtension,
    mermaidTheme,
    foldTreeSync,
  ];
}
