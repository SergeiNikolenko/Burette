export const CODE_VIEWER_LONG_LINE_RENDER_MAX = 4096;

const CODE_VIEWER_LONG_LINE_HEAD_CHARS = 3072;
const CODE_VIEWER_LONG_LINE_TAIL_CHARS = 768;

export type CodeLineRenderText = {
  isTruncated: boolean;
  omittedCharacterCount: number;
  text: string;
};

export function getCodeLineRenderText(text: string): CodeLineRenderText {
  if (text.length <= CODE_VIEWER_LONG_LINE_RENDER_MAX) {
    return {
      isTruncated: false,
      omittedCharacterCount: 0,
      text,
    };
  }

  const omittedCharacterCount =
    text.length -
    CODE_VIEWER_LONG_LINE_HEAD_CHARS -
    CODE_VIEWER_LONG_LINE_TAIL_CHARS;

  return {
    isTruncated: true,
    omittedCharacterCount,
    text:
      text.slice(0, CODE_VIEWER_LONG_LINE_HEAD_CHARS) +
      ` ... ${omittedCharacterCount} chars omitted ... ` +
      text.slice(-CODE_VIEWER_LONG_LINE_TAIL_CHARS),
  };
}

export function getCodeLongLineSelectionText({
  rowHost,
  selection,
  textLines,
}: {
  rowHost: HTMLPreElement;
  selection: Selection | null;
  textLines: readonly string[];
}) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const selectedLineIndexes = new Set<number>();
  let includesTruncatedLine = false;

  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex);
    if (!rangeIntersectsNode(range, rowHost)) continue;

    for (const row of rowHost.querySelectorAll<HTMLElement>(
      "[data-line-index]",
    )) {
      if (!rangeIntersectsNode(range, row)) continue;

      const lineIndex = Number(row.dataset.lineIndex);
      if (
        Number.isInteger(lineIndex) &&
        lineIndex >= 0 &&
        lineIndex < textLines.length
      ) {
        selectedLineIndexes.add(lineIndex);
      }
      if (row.dataset.codeLineTruncated != null) {
        includesTruncatedLine = true;
      }
    }
  }

  if (!includesTruncatedLine || selectedLineIndexes.size === 0) return null;

  return Array.from(selectedLineIndexes)
    .sort((first, second) => first - second)
    .map((lineIndex) => textLines[lineIndex] ?? "")
    .join("\n");
}

function rangeIntersectsNode(range: Range, node: Node) {
  try {
    if (range.intersectsNode(node)) return true;
  } catch {
    // Detached test DOM can make intersectsNode throw even when the selected
    // content is plainly inside the row.
  }
  return (
    node === range.commonAncestorContainer ||
    node.contains(range.commonAncestorContainer)
  );
}
