import type { DocxTarget } from "./docx-viewer-types";

export interface DocxRenderIndex {
  pages: readonly HTMLElement[];
  root: HTMLElement;
  text: DocxTextIndex | null;
  cells: Map<string, DocxCellHit> | null;
}

interface DocxTextIndex {
  text: string;
  spans: DocxTextSpan[];
}

interface DocxTextSpan {
  start: number;
  end: number;
  node: Text;
  page: HTMLElement;
  pageNumber: number;
  sourceStartOffset: number;
}

interface DocxTextPoint {
  node: Text;
  offset: number;
  page: HTMLElement;
  pageNumber: number;
}

interface DocxCellHit {
  cell: HTMLElement;
  page: HTMLElement;
  pageNumber: number;
}

export interface DocxResolvedTarget {
  page: HTMLElement;
  pageNumber: number;
  range: Range;
  startContainer: Node;
}

const INLINE_TAGS = new Set([
  "SPAN",
  "A",
  "B",
  "I",
  "EM",
  "STRONG",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "INS",
  "SMALL",
  "BIG",
  "SUB",
  "SUP",
  "MARK",
  "FONT",
  "CODE",
  "ABBR",
  "CITE",
  "Q",
  "TIME",
  "BDI",
  "BDO",
  "WBR",
  "LABEL",
  "VAR",
  "SAMP",
  "KBD",
  "TT",
  "NOBR",
]);

export function buildDocxRenderIndex(
  root: HTMLElement,
  pages: readonly HTMLElement[] = Array.from(
    root.querySelectorAll<HTMLElement>(".docx-wrapper > section.docx"),
  ),
): DocxRenderIndex {
  return {
    pages,
    root,
    text: null,
    cells: null,
  };
}

export function resolveDocxTarget(
  index: DocxRenderIndex,
  target: DocxTarget,
): Range | null {
  return resolveDocxTargetHit(index, target)?.range ?? null;
}

export function resolveDocxTargetHit(
  index: DocxRenderIndex,
  target: DocxTarget,
): DocxResolvedTarget | null {
  if (target.kind === "cell") {
    const cells = index.cells ?? (index.cells = buildDocxCellIndex(index));
    const hit = cells.get(cellKey(target.table, target.row, target.column));
    if (!hit) return null;
    const range = document.createRange();
    range.selectNodeContents(hit.cell);
    return {
      page: hit.page,
      pageNumber: hit.pageNumber,
      range,
      startContainer: hit.cell,
    };
  }

  const needle = normalizeTextTarget(target.text);
  if (!needle) return null;
  const textIndex = index.text ?? (index.text = buildDocxTextIndex(index));
  const idx = textIndex.text.indexOf(needle);
  if (idx === -1) return null;
  const start = findTextPoint(textIndex, idx);
  const end = findTextPoint(textIndex, idx + needle.length - 1);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return {
    page: start.page,
    pageNumber: start.pageNumber,
    range,
    startContainer: start.node,
  };
}

export function targetKey(
  target: DocxTarget | null | undefined,
): string | null {
  if (!target) return null;
  return target.kind === "cell"
    ? `cell:${target.table}:${target.row}:${target.column}`
    : `text:${normalizeTextTarget(target.text)}`;
}

export function normalizeTextTarget(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function buildDocxCellIndex(index: DocxRenderIndex) {
  const cells = new Map<string, DocxCellHit>();
  let tableIndex = 0;
  index.pages.forEach((page, pageIndex) => {
    const tables = page.querySelectorAll("table");
    tables.forEach((table) => {
      Array.from((table as HTMLTableElement).rows).forEach((row, rowIndex) => {
        Array.from(row.cells).forEach((cell, columnIndex) => {
          if (!hasHiddenAncestor(cell, page)) {
            cells.set(cellKey(tableIndex, rowIndex, columnIndex), {
              cell,
              page,
              pageNumber: pageIndex + 1,
            });
          }
        });
      });
      tableIndex += 1;
    });
  });
  return cells;
}

function buildDocxTextIndex(index: DocxRenderIndex) {
  const pages = index.pages;
  let normalized = "";
  const spans: DocxTextSpan[] = [];
  let prevSpace = false;
  let prevBlock: HTMLElement | null = null;
  let pendingBreak = false;

  const append = (
    text: string,
    node: Text,
    page: HTMLElement,
    pageNumber: number,
    sourceStartOffset: number,
  ) => {
    if (!text) return;
    const start = normalized.length;
    normalized += text;
    spans.push({
      start,
      end: start + text.length,
      node,
      page,
      pageNumber,
      sourceStartOffset,
    });
  };

  pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const walker = document.createTreeWalker(
      page,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = (n as HTMLElement).tagName;
        if (
          (tag === "BR" || tag === "HR") &&
          isDocumentBreakElement(page, n as HTMLElement)
        ) {
          pendingBreak = true;
        }
        continue;
      }
      if (!isDocumentTextNode(page, n as Text)) continue;
      const block = blockContainer((n as Text).parentElement, page);
      const broke = pendingBreak || (prevBlock !== null && block !== prevBlock);
      pendingBreak = false;
      if (broke && !prevSpace && normalized) {
        prevSpace = true;
        append(" ", n as Text, page, pageNumber, 0);
      }
      prevBlock = block;
      const data = (n as Text).data;
      for (let i = 0; i < data.length; i++) {
        if (/\s/.test(data[i])) {
          if (prevSpace) continue;
          prevSpace = true;
          append(" ", n as Text, page, pageNumber, i);
        } else {
          const start = i;
          i += 1;
          while (i < data.length && !/\s/.test(data[i])) i += 1;
          append(data.slice(start, i), n as Text, page, pageNumber, start);
          i -= 1;
          prevSpace = false;
        }
      }
    }
  });
  return { text: normalized, spans };
}

function findTextPoint(
  index: DocxTextIndex,
  offset: number,
): DocxTextPoint | null {
  let low = 0;
  let high = index.spans.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const span = index.spans[mid]!;
    if (offset < span.start) {
      high = mid - 1;
    } else if (offset >= span.end) {
      low = mid + 1;
    } else {
      return {
        node: span.node,
        offset: span.sourceStartOffset + offset - span.start,
        page: span.page,
        pageNumber: span.pageNumber,
      };
    }
  }
  return null;
}

function cellKey(table: number, row: number, column: number) {
  return `${table}:${row}:${column}`;
}

function blockContainer(
  el: HTMLElement | null,
  root: HTMLElement,
): HTMLElement {
  let cur = el;
  while (cur && cur !== root && INLINE_TAGS.has(cur.tagName)) {
    cur = cur.parentElement;
  }
  return cur ?? root;
}

function isDocumentTextNode(page: HTMLElement, node: Text) {
  const parent = node.parentElement;
  if (!parent || !page.contains(parent)) return false;
  if (parent.closest("style, script, noscript, template")) return false;
  return !hasHiddenAncestor(parent, page);
}

function isDocumentBreakElement(page: HTMLElement, el: HTMLElement) {
  if (!page.contains(el)) return false;
  return !hasHiddenAncestor(el, page);
}

function hasHiddenAncestor(element: HTMLElement, root: HTMLElement) {
  for (let el: HTMLElement | null = element; el; el = el.parentElement) {
    if (
      el.hidden ||
      el.getAttribute("aria-hidden")?.trim().toLowerCase() === "true"
    ) {
      return true;
    }
    const style =
      typeof window !== "undefined" ? window.getComputedStyle(el) : el.style;
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.getPropertyValue("content-visibility") === "hidden"
    ) {
      return true;
    }
    if (el === root) break;
  }
  return false;
}
