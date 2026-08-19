import type { CodeTokenLeaf } from "./code-viewer-syntax-protocol";

export function markdownCodeTokensToHtml({
  highlightPattern,
  line,
  tokens,
}: {
  highlightPattern: string;
  line: string;
  tokens: readonly CodeTokenLeaf[] | null;
}) {
  if (!tokens) return null;
  if (!tokens.length) return " ";
  const highlightStart = highlightPattern ? line.indexOf(highlightPattern) : -1;
  const highlightEnd =
    highlightStart >= 0 ? highlightStart + highlightPattern.length : -1;
  let cursor = 0;
  let html = "";

  for (const token of tokens) {
    const tokenStart = cursor;
    const tokenEnd = cursor + token.text.length;
    cursor = tokenEnd;
    html += tokenToHtml({
      highlightEnd,
      highlightStart,
      token,
      tokenEnd,
      tokenStart,
    });
  }

  return html || " ";
}

function tokenToHtml({
  highlightEnd,
  highlightStart,
  token,
  tokenEnd,
  tokenStart,
}: {
  highlightEnd: number;
  highlightStart: number;
  token: CodeTokenLeaf;
  tokenEnd: number;
  tokenStart: number;
}) {
  const inner = tokenTextToHtml({
    highlightEnd,
    highlightStart,
    text: token.text,
    textEnd: tokenEnd,
    textStart: tokenStart,
  });
  if (!token.kind || !/^[a-z-]+$/.test(token.kind)) return inner;
  return `<span class="cv-token-${token.kind}" data-pretext-code-token="${token.kind}">${inner}</span>`;
}

function tokenTextToHtml({
  highlightEnd,
  highlightStart,
  text,
  textEnd,
  textStart,
}: {
  highlightEnd: number;
  highlightStart: number;
  text: string;
  textEnd: number;
  textStart: number;
}) {
  if (
    highlightStart < 0 ||
    textEnd <= highlightStart ||
    textStart >= highlightEnd
  ) {
    return escapeHtml(text);
  }

  const before = text.slice(0, Math.max(0, highlightStart - textStart));
  const highlighted = text.slice(
    Math.max(0, highlightStart - textStart),
    Math.min(text.length, highlightEnd - textStart),
  );
  const after = text.slice(Math.min(text.length, highlightEnd - textStart));
  return [
    escapeHtml(before),
    highlighted
      ? `<span data-highlighted-chars="">${escapeHtml(highlighted)}</span>`
      : "",
    escapeHtml(after),
  ].join("");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
