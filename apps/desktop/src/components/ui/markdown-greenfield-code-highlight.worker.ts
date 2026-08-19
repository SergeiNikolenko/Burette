import { shouldTokenizeCodeLine } from "./code-viewer-syntax-protocol";
import {
  ensureCodePrismLanguage,
  tokenizeCodeLine,
} from "./code-viewer-syntax-prism";
import { markdownCodeTokensToHtml } from "./markdown-greenfield-code-highlight-html";
import type {
  MarkdownCodeHighlightWorkerRequest,
  MarkdownCodeHighlightWorkerResponse,
} from "./markdown-greenfield-code-highlight-protocol";

const workerSelf = self as unknown as {
  onmessage:
    | ((event: MessageEvent<MarkdownCodeHighlightWorkerRequest>) => void)
    | null;
  postMessage(message: MarkdownCodeHighlightWorkerResponse): void;
};

function post(message: MarkdownCodeHighlightWorkerResponse) {
  workerSelf.postMessage(message);
}

async function highlightInWorker(request: MarkdownCodeHighlightWorkerRequest) {
  await ensureCodePrismLanguage(request.languageId);
  post({
    generation: request.generation,
    languageId: request.languageId,
    requestId: request.requestId,
    results: request.lines.map(({ index, line }) => ({
      html: shouldTokenizeCodeLine(line)
        ? markdownCodeTokensToHtml({
            highlightPattern: request.highlightPattern,
            line,
            tokens: tokenizeCodeLine(request.languageId, line),
          })
        : null,
      index,
    })),
    type: "highlighted",
  });
}

workerSelf.onmessage = (
  event: MessageEvent<MarkdownCodeHighlightWorkerRequest>,
) => {
  const request = event.data;
  if (request.type !== "highlight") return;

  void highlightInWorker(request).catch((error) => {
    post({
      generation: request.generation,
      languageId: request.languageId,
      message: error instanceof Error ? error.message : String(error),
      requestId: request.requestId,
      type: "error",
    });
  });
};
