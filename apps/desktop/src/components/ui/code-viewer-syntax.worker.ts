import {
  type CodeSyntaxWorkerRequest,
  type CodeSyntaxWorkerResponse,
  shouldTokenizeCodeLine,
} from "./code-viewer-syntax-protocol";
import {
  ensureCodeLanguage,
  tokenizeCodeLine,
} from "./code-viewer-syntax-shiki";

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<CodeSyntaxWorkerRequest>) => void) | null;
  postMessage(message: CodeSyntaxWorkerResponse): void;
};

function post(message: CodeSyntaxWorkerResponse) {
  workerSelf.postMessage(message);
}

async function tokenizeInWorker(request: CodeSyntaxWorkerRequest) {
  await ensureCodeLanguage(request.languageId);
  post({
    type: "tokens",
    requestId: request.requestId,
    generation: request.generation,
    languageId: request.languageId,
    results: request.lines.map((line) => ({
      line,
      tokens: shouldTokenizeCodeLine(line)
        ? tokenizeCodeLine(request.languageId, line)
        : null,
    })),
  });
}

workerSelf.onmessage = (event: MessageEvent<CodeSyntaxWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "tokenize") return;

  void tokenizeInWorker(request).catch((error) => {
    post({
      type: "error",
      requestId: request.requestId,
      generation: request.generation,
      languageId: request.languageId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
