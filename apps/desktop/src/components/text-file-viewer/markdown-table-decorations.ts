import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet, selectAllDecorationsOnSelectExtension } from "@prosemark/core";

type Alignment = "left" | "center" | "right";

interface ParsedTable {
  headers: string[];
  alignments: (Alignment | undefined)[];
  rows: string[][];
}

function parseCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const stripped = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return stripped.split("|").map((cell) => cell.trim());
}

function parseAlignment(cell: string): Alignment | undefined {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return undefined;
}

function parseMarkdownTable(text: string): ParsedTable | undefined {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return undefined;

  const headers = parseCells(lines[0]);
  const delimiterCells = parseCells(lines[1]);
  if (!delimiterCells.every((cell) => /^:?-+:?$/.test(cell))) return undefined;

  return {
    headers,
    alignments: delimiterCells.map(parseAlignment),
    rows: lines.slice(2).map(parseCells),
  };
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: ParsedTable,
    readonly rawText: string,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return this.rawText === other.rawText;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-widget";
    wrapper.contentEditable = "false";

    const table = wrapper.appendChild(document.createElement("table"));
    const thead = table.appendChild(document.createElement("thead"));
    const headerRow = thead.appendChild(document.createElement("tr"));
    for (let index = 0; index < this.table.headers.length; index += 1) {
      const th = headerRow.appendChild(document.createElement("th"));
      th.textContent = this.table.headers[index];
      const alignment = this.table.alignments[index];
      if (alignment) th.style.textAlign = alignment;
    }

    const tbody = table.appendChild(document.createElement("tbody"));
    for (const row of this.table.rows) {
      const tr = tbody.appendChild(document.createElement("tr"));
      for (let index = 0; index < this.table.headers.length; index += 1) {
        const td = tr.appendChild(document.createElement("td"));
        td.textContent = row[index] ?? "";
        const alignment = this.table.alignments[index];
        if (alignment) td.style.textAlign = alignment;
      }
    }

    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const tableFoldExtension = foldableSyntaxFacet.of({
  nodePath: "Table",
  buildDecorations: (state, node) => {
    const text = state.doc.sliceString(node.from, node.to);
    const table = parseMarkdownTable(text);
    if (!table) return undefined;
    return Decoration.replace({
      widget: new TableWidget(table, text),
      block: true,
      inclusiveStart: true,
    }).range(node.from, node.to);
  },
});

const tableTheme = EditorView.baseTheme({
  ".cm-table-widget": {
    padding: "0.25em 0",
    overflowX: "auto",
  },
  ".cm-table-widget table": {
    borderCollapse: "collapse",
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
    fontSize: "0.9em",
  },
  ".cm-table-widget th, .cm-table-widget td": {
    border: "1px solid var(--border-color, #3e3e42)",
    padding: "0.4em 0.8em",
    minWidth: "10em",
  },
  ".cm-table-widget th": {
    fontWeight: "600",
    backgroundColor: "var(--code-bg, var(--surface-subtle))",
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

export function markdownTableDecorations() {
  return [
    tableFoldExtension,
    tableTheme,
    selectAllDecorationsOnSelectExtension("cm-table-widget"),
    foldTreeSync,
  ];
}
