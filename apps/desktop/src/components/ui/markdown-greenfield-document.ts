"use client";

import type {
  MarkdownHastElement,
  MarkdownHastNode,
} from "./markdown-hast-types";
import {
  markdownSourceRangeFromPosition,
  markdownSourceTextForRange,
  type MarkdownSourceRange,
} from "./markdown-source-map";
import {
  createMarkdownUnifiedDocument,
  type MarkdownUnifiedDocument,
} from "./markdown-unified-pipeline";

const TARGET_CHUNK_SOURCE_LINES = 42;
const MAX_CHUNK_SOURCE_LINES = 64;
const HOSTILE_CODE_LINE_COUNT = 400;
const HOSTILE_HAST_NODE_COUNT = 3_000;
const HOSTILE_HAST_DEPTH = 80;
const HOSTILE_TEXT_LENGTH = 20_000;
const HOSTILE_TABLE_CELL_COUNT = 50_000;
const HOSTILE_TABLE_HAST_NODE_COUNT = 120_000;
const HOSTILE_TABLE_TEXT_LENGTH = 1_000_000;
const DOCUMENT_CACHE_LIMIT = 24;

const markdownGreenfieldDocumentCache = new Map<
  string,
  {
    document: MarkdownGreenfieldDocument;
    text: string;
  }
>();

export type MarkdownGreenfieldBlockKind =
  | "blockquote"
  | "code"
  | "component"
  | "diagram"
  | "footnotes"
  | "frontmatter"
  | "heading"
  | "html"
  | "image"
  | "list"
  | "math"
  | "paragraph"
  | "table"
  | "thematicBreak"
  | "unknown";

export type MarkdownGreenfieldDocument = {
  blocks: MarkdownGreenfieldBlock[];
  chunks: MarkdownGreenfieldChunk[];
  fragmentTargets: MarkdownGreenfieldFragmentTarget[];
  headings: MarkdownGreenfieldHeading[];
  lineCount: number;
  text: string;
  unified: MarkdownUnifiedDocument;
  wordCount: number;
};

export type MarkdownGreenfieldHeading = {
  blockId: string;
  id: string;
  sourceLine: number;
  text: string;
};

export type MarkdownGreenfieldFragmentTarget = {
  blockId: string;
  id: string;
  sourceLine: number;
};

export type MarkdownGreenfieldBlock = {
  hastChildren: MarkdownHastNode[];
  id: string;
  index: number;
  isGenerated: boolean;
  isHostile: boolean;
  kind: MarkdownGreenfieldBlockKind;
  sourceLineCount: number;
  sourceLineLengths: readonly number[];
  sourceRange: MarkdownSourceRange | null;
  sourceText: string;
};

export type MarkdownGreenfieldChunk = {
  blockIds: string[];
  hastChildren: MarkdownHastNode[];
  id: string;
  index: number;
  isHostile: boolean;
  nativeFindText: string;
  sourceEndLine: number;
  sourceLineCount: number;
  sourceRange: MarkdownSourceRange | null;
  sourceStartLine: number;
  sourceText: string;
};

export function createMarkdownGreenfieldDocument(
  markdown: string,
): MarkdownGreenfieldDocument {
  const text = markdown.length ? markdown : " ";
  const cacheKey = markdownGreenfieldDocumentTextKey(text);
  const cached = markdownGreenfieldDocumentCache.get(cacheKey);
  if (cached?.text === text) {
    markdownGreenfieldDocumentCache.delete(cacheKey);
    markdownGreenfieldDocumentCache.set(cacheKey, cached);
    return cached.document;
  }

  const document = createUncachedMarkdownGreenfieldDocument(text);
  markdownGreenfieldDocumentCache.set(cacheKey, {
    document,
    text,
  });
  while (markdownGreenfieldDocumentCache.size > DOCUMENT_CACHE_LIMIT) {
    const oldestKey = markdownGreenfieldDocumentCache.keys().next().value;
    if (!oldestKey) break;
    markdownGreenfieldDocumentCache.delete(oldestKey);
  }

  return document;
}

function createUncachedMarkdownGreenfieldDocument(
  text: string,
): MarkdownGreenfieldDocument {
  const unified = createMarkdownUnifiedDocument(text);
  normalizeMarkdownGreenfieldHeadingIds(unified.hast.children, unified);
  normalizeMarkdownGreenfieldTables(unified.hast.children);
  annotateMarkdownGreenfieldSourceMetadata(unified.hast.children, unified);
  const blocks = createMarkdownGreenfieldBlocks({ text, unified });
  const chunks = createMarkdownGreenfieldChunks({ blocks, text });
  const headings = createMarkdownGreenfieldHeadings(blocks);
  const fragmentTargets = createMarkdownGreenfieldFragmentTargets({
    blocks,
    unified,
  });

  return freezeMarkdownGreenfieldDocument({
    blocks,
    chunks,
    fragmentTargets,
    headings,
    lineCount: unified.sourceMap.lineCount,
    text,
    unified,
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
  });
}

export function findMarkdownGreenfieldHeadingById(
  document: MarkdownGreenfieldDocument,
  headingId: string,
) {
  const normalizedId = headingId.replace(/^#/, "");
  return document.headings.find((heading) => heading.id === normalizedId);
}

export function findMarkdownGreenfieldFragmentTargetById(
  document: MarkdownGreenfieldDocument,
  fragmentId: string,
) {
  const normalizedId = normalizeFragmentTargetId(fragmentId);
  return document.fragmentTargets.find((target) => target.id === normalizedId);
}

export function findMarkdownGreenfieldBlockById(
  document: MarkdownGreenfieldDocument,
  blockId: string,
) {
  return document.blocks.find((block) => block.id === blockId) ?? null;
}

export function findMarkdownGreenfieldChunkByBlockId(
  document: MarkdownGreenfieldDocument,
  blockId: string,
) {
  return (
    document.chunks.find((chunk) => chunk.blockIds.includes(blockId)) ?? null
  );
}

export function findMarkdownGreenfieldBlockBySourceLine(
  document: MarkdownGreenfieldDocument,
  sourceLine: number,
) {
  const line = clampSourceLine(sourceLine, document.lineCount);
  return (
    document.blocks.find((block) => {
      const range = block.sourceRange;
      return range && range.startLine <= line && range.endLine >= line;
    }) ?? null
  );
}

export function findMarkdownGreenfieldChunkBySourceLine(
  document: MarkdownGreenfieldDocument,
  sourceLine: number,
) {
  const block = findMarkdownGreenfieldBlockBySourceLine(document, sourceLine);
  if (block) return findMarkdownGreenfieldChunkByBlockId(document, block.id);

  const line = clampSourceLine(sourceLine, document.lineCount);
  return (
    document.chunks.find(
      (chunk) => chunk.sourceStartLine <= line && chunk.sourceEndLine >= line,
    ) ?? null
  );
}

export function findMarkdownGreenfieldBlockBySourceOffset(
  document: MarkdownGreenfieldDocument,
  sourceOffset: number,
) {
  const offset = clampSourceOffset(sourceOffset, document.text.length);
  return (
    document.blocks.find((block) => {
      const range = block.sourceRange;
      return range && range.startOffset <= offset && range.endOffset > offset;
    }) ?? null
  );
}

export function findMarkdownGreenfieldChunkBySourceOffset(
  document: MarkdownGreenfieldDocument,
  sourceOffset: number,
) {
  const block = findMarkdownGreenfieldBlockBySourceOffset(
    document,
    sourceOffset,
  );
  return block
    ? findMarkdownGreenfieldChunkByBlockId(document, block.id)
    : null;
}

function createMarkdownGreenfieldBlocks({
  text,
  unified,
}: {
  text: string;
  unified: MarkdownUnifiedDocument;
}) {
  const blocks: MarkdownGreenfieldBlock[] = [];

  for (const child of unified.hast.children) {
    if (isWhitespaceText(child)) continue;

    const directSourceRange = markdownSourceRangeFromPosition({
      position: child.position,
      sourceMap: unified.sourceMap,
    });
    const sourceRange =
      directSourceRange ?? markdownSyntheticSourceRangeForNode(child, unified);
    const kind = markdownBlockKindForHastChild(child);
    const sourceText = markdownSourceTextForRange({
      range: sourceRange,
      sourceMap: unified.sourceMap,
    });
    const normalizedSourceText =
      sourceText ||
      (sourceRange
        ? text.slice(sourceRange.startOffset, sourceRange.endOffset)
        : "");
    const sourceMetrics =
      markdownGreenfieldSourceMetricsForText(normalizedSourceText);
    const line = sourceRange?.startLine ?? unified.sourceMap.lineCount;
    const block: MarkdownGreenfieldBlock = {
      hastChildren: [child],
      id: `block-${blocks.length + 1}-${line}-${kind}`,
      index: blocks.length,
      isGenerated: !directSourceRange,
      isHostile: isHostileMarkdownGreenfieldBlock({
        child,
        kind,
        sourceLineCount: sourceMetrics.sourceLineCount,
        sourceText: normalizedSourceText,
      }),
      kind,
      sourceLineCount: sourceMetrics.sourceLineCount,
      sourceLineLengths: sourceMetrics.sourceLineLengths,
      sourceRange,
      sourceText: normalizedSourceText,
    };
    blocks.push(block);
  }

  if (!blocks.length) {
    const sourceMetrics = markdownGreenfieldSourceMetricsForText(text);
    blocks.push({
      hastChildren: [],
      id: "block-1-empty",
      index: 0,
      isGenerated: true,
      isHostile: false,
      kind: "paragraph",
      sourceLineCount: sourceMetrics.sourceLineCount,
      sourceLineLengths: sourceMetrics.sourceLineLengths,
      sourceRange: {
        endLine: 1,
        endOffset: text.length,
        startLine: 1,
        startOffset: 0,
      },
      sourceText: text,
    });
  }

  return blocks;
}

function createMarkdownGreenfieldChunks({
  blocks,
  text,
}: {
  blocks: readonly MarkdownGreenfieldBlock[];
  text: string;
}) {
  const chunks: MarkdownGreenfieldChunk[] = [];
  let current: MarkdownGreenfieldBlock[] = [];

  const flush = () => {
    if (!current.length) return;
    chunks.push(createChunk(current, chunks.length, text));
    current = [];
  };

  for (const block of blocks) {
    if (block.isHostile) {
      flush();
      current.push(block);
      flush();
      continue;
    }

    const nextLineCount = lineCountForBlocks(current, block);
    const startsNewChunk =
      current.length > 0 &&
      block.kind === "heading" &&
      nextLineCount >= TARGET_CHUNK_SOURCE_LINES;
    const exceedsMax =
      current.length > 0 && nextLineCount > MAX_CHUNK_SOURCE_LINES;

    if (startsNewChunk || exceedsMax) flush();
    current.push(block);
  }

  flush();
  return chunks;
}

function createChunk(
  blocks: readonly MarkdownGreenfieldBlock[],
  index: number,
  text: string,
): MarkdownGreenfieldChunk {
  const ranges = blocks
    .map((block) => block.sourceRange)
    .filter((range): range is MarkdownSourceRange => Boolean(range));
  const sourceRange = ranges.length
    ? {
        endLine: Math.max(...ranges.map((range) => range.endLine)),
        endOffset: Math.max(...ranges.map((range) => range.endOffset)),
        startLine: Math.min(...ranges.map((range) => range.startLine)),
        startOffset: Math.min(...ranges.map((range) => range.startOffset)),
      }
    : null;
  const sourceStartLine =
    sourceRange?.startLine ?? blocks[0]?.sourceRange?.startLine ?? 1;
  const sourceEndLine =
    sourceRange?.endLine ??
    blocks[blocks.length - 1]?.sourceRange?.endLine ??
    sourceStartLine;
  const sourceLineCount = sourceRange
    ? sourceEndLine - sourceStartLine + 1
    : Math.max(
        1,
        blocks.reduce((sum, block) => sum + block.sourceLineCount, 0),
      );
  const hastChildren = blocks.flatMap((block) => block.hastChildren);

  return {
    blockIds: blocks.map((block) => block.id),
    hastChildren,
    id: `chunk-${index + 1}-${sourceStartLine}`,
    index,
    isHostile: blocks.some((block) => block.isHostile),
    nativeFindText: nativeFindTextForHastChildren(hastChildren),
    sourceEndLine,
    sourceLineCount,
    sourceRange,
    sourceStartLine,
    sourceText: sourceRange
      ? text.slice(sourceRange.startOffset, sourceRange.endOffset)
      : "",
  };
}

function createMarkdownGreenfieldHeadings(
  blocks: readonly MarkdownGreenfieldBlock[],
) {
  return blocks.flatMap((block) => {
    const element = readHastElement(block.hastChildren[0]);
    if (!element || !/^h[1-6]$/.test(element.tagName)) return [];

    const id = readStringProperty(element.properties?.id);
    if (!id) return [];

    return [
      {
        blockId: block.id,
        id,
        sourceLine: block.sourceRange?.startLine ?? 1,
        text: extractHastText(element).trim(),
      },
    ];
  });
}

function createMarkdownGreenfieldFragmentTargets({
  blocks,
  unified,
}: {
  blocks: readonly MarkdownGreenfieldBlock[];
  unified: MarkdownUnifiedDocument;
}) {
  const targets = new Map<string, MarkdownGreenfieldFragmentTarget>();

  for (const block of blocks) {
    for (const child of block.hastChildren) {
      collectFragmentTargets({
        block,
        node: child,
        targets,
        unified,
      });
    }
  }

  return Array.from(targets.values());
}

function collectFragmentTargets({
  block,
  node,
  targets,
  unified,
}: {
  block: MarkdownGreenfieldBlock;
  node: MarkdownHastNode;
  targets: Map<string, MarkdownGreenfieldFragmentTarget>;
  unified: MarkdownUnifiedDocument;
}) {
  const element = readHastElement(node);
  if (!element) return;

  const id = readStringProperty(element.properties?.id);
  if (id) {
    const sourceRange =
      markdownSourceRangeFromPosition({
        position: element.position,
        sourceMap: unified.sourceMap,
      }) ?? block.sourceRange;
    const target = {
      blockId: block.id,
      id,
      sourceLine: sourceRange?.startLine ?? unified.sourceMap.lineCount,
    };

    for (const alias of fragmentTargetAliases(id)) {
      if (!targets.has(alias)) {
        targets.set(alias, { ...target, id: alias });
      }
    }
  }

  for (const child of element.children) {
    collectFragmentTargets({ block, node: child, targets, unified });
  }
}

function markdownSyntheticSourceRangeForNode(
  node: MarkdownHastNode,
  unified: MarkdownUnifiedDocument,
): MarkdownSourceRange | null {
  const ranges = collectMarkdownSourceRanges(node, unified);
  if (!ranges.length) return null;
  return {
    endLine: Math.max(...ranges.map((range) => range.endLine)),
    endOffset: Math.max(...ranges.map((range) => range.endOffset)),
    startLine: Math.min(...ranges.map((range) => range.startLine)),
    startOffset: Math.min(...ranges.map((range) => range.startOffset)),
  };
}

function collectMarkdownSourceRanges(
  node: MarkdownHastNode,
  unified: MarkdownUnifiedDocument,
): MarkdownSourceRange[] {
  const range = markdownSourceRangeFromPosition({
    position: node.position,
    sourceMap: unified.sourceMap,
  });
  const element = readHastElement(node);
  return [
    ...(range ? [range] : []),
    ...(element?.children ?? []).flatMap((child) =>
      collectMarkdownSourceRanges(child, unified),
    ),
  ];
}

function normalizeMarkdownGreenfieldHeadingIds(
  nodes: readonly MarkdownHastNode[],
  unified: MarkdownUnifiedDocument,
) {
  const usedIds = new Map<string, number>();
  for (const node of nodes) {
    normalizeHeadingIdsInNode(node, usedIds, unified);
  }
}

function normalizeHeadingIdsInNode(
  node: MarkdownHastNode,
  usedIds: Map<string, number>,
  unified: MarkdownUnifiedDocument,
) {
  const element = readHastElement(node);
  if (!element) return;

  if (/^h[1-6]$/.test(element.tagName)) {
    const visibleText = extractHastText(element);
    const markdownText = markdownHeadingTextFromSource(element, unified);
    const baseId = safeHeadingIdForText(
      markdownText.includes("__proto__") ? markdownText : visibleText,
    );
    const duplicateCount = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, duplicateCount + 1);
    element.properties = {
      ...element.properties,
      id: duplicateCount === 0 ? baseId : `${baseId}-${duplicateCount}`,
    };
  }

  for (const child of element.children) {
    normalizeHeadingIdsInNode(child, usedIds, unified);
  }
}

function markdownHeadingTextFromSource(
  element: MarkdownHastElement,
  unified: MarkdownUnifiedDocument,
) {
  const range = markdownSourceRangeFromPosition({
    position: element.position,
    sourceMap: unified.sourceMap,
  });
  if (!range) return "";
  return markdownSourceTextForRange({
    range,
    sourceMap: unified.sourceMap,
  })
    .replace(/^\s{0,3}#{1,6}[ \t]*/, "")
    .replace(/[ \t]+#*\s*$/, "")
    .trim();
}

function safeHeadingIdForText(text: string) {
  const slug =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section";

  return isDomClobberingId(slug) ? `section-${slug}` : slug;
}

function normalizeFragmentTargetId(fragmentId: string) {
  return decodeURIComponent(fragmentId.replace(/^#/, ""));
}

function fragmentTargetAliases(id: string) {
  const aliases = new Set<string>([normalizeFragmentTargetId(id)]);
  const withoutRepeatedClobberPrefix = id.replace(
    /^(user-content-)+/,
    "user-content-",
  );
  aliases.add(withoutRepeatedClobberPrefix);
  aliases.add(withoutRepeatedClobberPrefix.replace(/^user-content-/, ""));
  return Array.from(aliases).filter(Boolean);
}

function normalizeMarkdownGreenfieldTables(nodes: readonly MarkdownHastNode[]) {
  let tableIndex = 0;
  for (const node of nodes) {
    tableIndex = normalizeTablesInNode(node, tableIndex);
  }
}

function normalizeTablesInNode(node: MarkdownHastNode, tableIndex: number) {
  const element = readHastElement(node);
  if (!element) return tableIndex;

  if (element.tagName === "table") {
    normalizeTableElement(element, tableIndex);
    tableIndex += 1;
  }

  for (const child of element.children) {
    tableIndex = normalizeTablesInNode(child, tableIndex);
  }
  return tableIndex;
}

function normalizeTableElement(table: MarkdownHastElement, tableIndex: number) {
  const rows = tableRows(table);
  const headerIds = new Map<number, string>();

  rows.forEach((row, rowIndex) => {
    row.properties = {
      ...row.properties,
      ariaRowIndex: rowIndex + 1,
      dataPretextTableRowIndex: rowIndex + 1,
    };

    tableCells(row).forEach((cell, columnIndex) => {
      const column = columnIndex + 1;
      const properties = {
        ...cell.properties,
        ariaColIndex: column,
        dataPretextTableColumnIndex: column,
      };
      if (cell.tagName === "th") {
        const id = `markdown-table-${tableIndex + 1}-column-${column}`;
        headerIds.set(columnIndex, id);
        cell.properties = {
          ...properties,
          id,
          scope: "col",
        };
      } else {
        cell.properties = {
          ...properties,
          headers: headerIds.get(columnIndex),
        };
      }
    });
  });
}

function annotateMarkdownGreenfieldSourceMetadata(
  nodes: readonly MarkdownHastNode[],
  unified: MarkdownUnifiedDocument,
) {
  for (const node of nodes) {
    annotateSourceMetadataInNode(node, unified);
  }
}

function annotateSourceMetadataInNode(
  node: MarkdownHastNode,
  unified: MarkdownUnifiedDocument,
) {
  const element = readHastElement(node);
  if (!element) return;

  const sourceRange = markdownSourceRangeFromPosition({
    position: element.position,
    sourceMap: unified.sourceMap,
  });
  if (sourceRange) {
    element.properties = {
      ...element.properties,
      dataPretextSourceEndLine: sourceRange.endLine,
      dataPretextSourceEndOffset: sourceRange.endOffset,
      dataPretextSourceStartLine: sourceRange.startLine,
      dataPretextSourceStartOffset: sourceRange.startOffset,
    };
  }

  for (const child of element.children) {
    annotateSourceMetadataInNode(child, unified);
  }
}

function tableRows(element: MarkdownHastElement) {
  const rows: MarkdownHastElement[] = [];
  for (const child of element.children) {
    const childElement = readHastElement(child);
    if (!childElement) continue;
    if (childElement.tagName === "tr") {
      rows.push(childElement);
    } else if (
      childElement.tagName === "thead" ||
      childElement.tagName === "tbody" ||
      childElement.tagName === "tfoot"
    ) {
      rows.push(...tableRows(childElement));
    }
  }
  return rows;
}

function tableCells(row: MarkdownHastElement) {
  return row.children
    .map(readHastElement)
    .filter(
      (child): child is MarkdownHastElement =>
        child?.tagName === "td" || child?.tagName === "th",
    );
}

function isDomClobberingId(id: string) {
  return [
    "__proto__",
    "constructor",
    "document",
    "forms",
    "history",
    "location",
    "name",
    "prototype",
    "window",
  ].includes(id);
}

function markdownBlockKindForHastChild(
  child: MarkdownHastNode,
): MarkdownGreenfieldBlockKind {
  const element = readHastElement(child);
  if (!element) return child.type === "text" ? "paragraph" : "unknown";

  if (element.properties?.dataFootnotes != null) return "footnotes";
  if (element.properties?.dataMarkdownFrontmatter != null) return "frontmatter";
  if (/^h[1-6]$/.test(element.tagName)) return "heading";
  if (isMarkdownDiagramElement(element)) return "diagram";
  if (isMarkdownComponentElement(element)) return "component";
  if (isDisplayMathElement(element)) return "math";

  switch (element.tagName) {
    case "blockquote":
      return "blockquote";
    case "hr":
      return "thematicBreak";
    case "ol":
    case "ul":
      return "list";
    case "p":
      if (isDisplayMathElement(element)) return "math";
      return firstElementChild(element)?.tagName === "img"
        ? "image"
        : "paragraph";
    case "pre":
      if (isMermaidCodeElement(element)) return "diagram";
      return "code";
    case "table":
      return "table";
    default:
      return "html";
  }
}

function isMarkdownDiagramElement(element: MarkdownHastElement) {
  return (
    readStringProperty(element.properties?.dataPretextComponentName) ===
    "Diagram"
  );
}

function isMarkdownComponentElement(element: MarkdownHastElement) {
  return (
    element.properties?.dataPretextComponentName != null ||
    element.properties?.dataPretextComponentFallback != null ||
    element.properties?.dataPretextCalloutKind != null
  );
}

function isDisplayMathElement(element: MarkdownHastElement): boolean {
  if (
    hasClassName(element, "katex-display") ||
    hasClassName(element, "math-display")
  )
    return true;
  return element.children
    .map(readHastElement)
    .some((child) => child != null && isDisplayMathElement(child));
}

function isMermaidCodeElement(element: MarkdownHastElement) {
  const code = firstElementChild(element);
  return (
    code?.tagName === "code" &&
    ["language-mermaid", "language-mmd", "language-mermaid-js"].some(
      (className) => hasClassName(code, className),
    )
  );
}

function hasClassName(element: MarkdownHastElement, className: string) {
  const classes = element.properties?.className;
  return Array.isArray(classes)
    ? classes.includes(className)
    : typeof classes === "string" && classes.split(/\s+/).includes(className);
}

function isHostileMarkdownGreenfieldBlock({
  child,
  kind,
  sourceLineCount,
  sourceText,
}: {
  child: MarkdownHastNode;
  kind: MarkdownGreenfieldBlockKind;
  sourceLineCount: number;
  sourceText: string;
}) {
  if (kind === "table") {
    if (sourceText.length > HOSTILE_TABLE_TEXT_LENGTH) return true;
    if (countTableCells(child) > HOSTILE_TABLE_CELL_COUNT) return true;
    if (countHastNodes(child) > HOSTILE_TABLE_HAST_NODE_COUNT) return true;
    if (maxHastDepth(child) > HOSTILE_HAST_DEPTH) return true;
    return false;
  }
  if (sourceText.length > HOSTILE_TEXT_LENGTH) return true;
  if (countHastNodes(child) > HOSTILE_HAST_NODE_COUNT) return true;
  if (maxHastDepth(child) > HOSTILE_HAST_DEPTH) return true;
  if (kind === "code" && sourceLineCount > HOSTILE_CODE_LINE_COUNT) {
    return true;
  }
  return false;
}

function countHastNodes(node: MarkdownHastNode): number {
  const element = readHastElement(node);
  return (
    1 +
    (element?.children ?? []).reduce(
      (sum, child) => sum + countHastNodes(child),
      0,
    )
  );
}

function maxHastDepth(node: MarkdownHastNode): number {
  const element = readHastElement(node);
  if (!element?.children.length) return 1;
  return 1 + Math.max(...element.children.map(maxHastDepth));
}

function lineCountForBlocks(
  blocks: readonly MarkdownGreenfieldBlock[],
  nextBlock: MarkdownGreenfieldBlock,
) {
  let fallbackLineCount = 0;
  let sourceEndLine = 0;
  let sourceStartLine = 0;

  for (const block of blocks) {
    fallbackLineCount += block.sourceLineCount;
    const range = block.sourceRange;
    if (!range) continue;
    sourceStartLine = sourceStartLine
      ? Math.min(sourceStartLine, range.startLine)
      : range.startLine;
    sourceEndLine = Math.max(sourceEndLine, range.endLine);
  }
  fallbackLineCount += nextBlock.sourceLineCount;
  const nextRange = nextBlock.sourceRange;
  if (nextRange) {
    sourceStartLine = sourceStartLine
      ? Math.min(sourceStartLine, nextRange.startLine)
      : nextRange.startLine;
    sourceEndLine = Math.max(sourceEndLine, nextRange.endLine);
  }

  if (!sourceStartLine) return Math.max(1, fallbackLineCount);
  return sourceEndLine - sourceStartLine + 1;
}

function countTableCells(node: MarkdownHastNode): number {
  const element = readHastElement(node);
  if (!element) return 0;
  const self = element.tagName === "td" || element.tagName === "th" ? 1 : 0;
  return (
    self +
    (element.children ?? []).reduce(
      (sum, child) => sum + countTableCells(child),
      0,
    )
  );
}

function markdownGreenfieldSourceMetricsForText(sourceText: string) {
  const sourceLineLengths: number[] = [];
  let sourceLineLength = 0;

  for (let index = 0; index < sourceText.length; index += 1) {
    const charCode = sourceText.charCodeAt(index);
    if (charCode === 13) {
      sourceLineLengths.push(sourceLineLength);
      sourceLineLength = 0;
      if (sourceText.charCodeAt(index + 1) === 10) index += 1;
      continue;
    }
    if (charCode === 10 || charCode === 0x2028 || charCode === 0x2029) {
      sourceLineLengths.push(sourceLineLength);
      sourceLineLength = 0;
      continue;
    }
    sourceLineLength += 1;
  }

  sourceLineLengths.push(sourceLineLength);
  return {
    sourceLineCount: sourceLineLengths.length,
    sourceLineLengths,
  };
}

function readHastElement(node: unknown): MarkdownHastElement | null {
  return node &&
    typeof node === "object" &&
    (node as MarkdownHastElement).type === "element"
    ? (node as MarkdownHastElement)
    : null;
}

function firstElementChild(element: MarkdownHastElement) {
  return element.children.map(readHastElement).find(Boolean) ?? null;
}

function isWhitespaceText(node: MarkdownHastNode) {
  return (
    node.type === "text" &&
    typeof node.value === "string" &&
    node.value.trim() === ""
  );
}

function readStringProperty(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  return "";
}

function extractHastText(node: MarkdownHastNode): string {
  if (node.type === "text" && typeof node.value === "string") return node.value;
  const element = readHastElement(node);
  if (!element) return "";
  return element.children.map(extractHastText).join("");
}

function nativeFindTextForHastChildren(children: readonly MarkdownHastNode[]) {
  const text: string[] = [];
  const stack = [...children].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "text" && typeof node.value === "string") {
      text.push(node.value);
      continue;
    }

    const element = readHastElement(node);
    if (!element) continue;
    if (element.tagName === "script" || element.tagName === "style") continue;
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      stack.push(element.children[index]!);
    }
  }
  return text.join(" ").trim();
}

function freezeMarkdownHastNode(node: unknown) {
  if (!node || typeof node !== "object" || Object.isFrozen(node)) return;

  const record = node as Record<string, unknown>;
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      value.forEach(freezeMarkdownHastNode);
      Object.freeze(value);
      continue;
    }
    if (value && typeof value === "object") {
      freezeMarkdownHastNode(value);
    }
  }
  Object.freeze(node);
}

export function freezeMarkdownGreenfieldDocument(
  document: MarkdownGreenfieldDocument,
) {
  freezeMarkdownHastNode(document.unified.hast);
  for (const block of document.blocks) {
    if (block.sourceRange) Object.freeze(block.sourceRange);
    Object.freeze(block.hastChildren);
    Object.freeze(block.sourceLineLengths);
    Object.freeze(block);
  }
  for (const chunk of document.chunks) {
    if (chunk.sourceRange) Object.freeze(chunk.sourceRange);
    Object.freeze(chunk.blockIds);
    Object.freeze(chunk.hastChildren);
    Object.freeze(chunk);
  }
  for (const heading of document.headings) Object.freeze(heading);
  for (const target of document.fragmentTargets) Object.freeze(target);
  Object.freeze(document.blocks);
  Object.freeze(document.chunks);
  Object.freeze(document.headings);
  Object.freeze(document.fragmentTargets);
  return Object.freeze(document);
}

export function markdownGreenfieldDocumentTextKey(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function clampSourceLine(line: number, lineCount: number) {
  if (!Number.isFinite(line)) return 1;
  return Math.max(1, Math.min(lineCount, Math.floor(line)));
}

function clampSourceOffset(offset: number, textLength: number) {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(textLength, Math.floor(offset)));
}
