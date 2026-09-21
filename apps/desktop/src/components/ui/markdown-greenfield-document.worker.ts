import { createMarkdownGreenfieldDocument } from "./markdown-greenfield-document";

type MarkdownDocumentWorkerRequest = {
  id: number;
  text: string;
  type: "parse";
};

type MarkdownDocumentWorkerResponse =
  | {
      type: "ready";
    }
  | {
      document: ReturnType<typeof createMarkdownGreenfieldDocument>;
      id: number;
      ok: true;
      type: "result";
    }
  | {
      failure: "clone_failed" | "parse_failed";
      id: number;
      message: string;
      ok: false;
      type: "result";
    };

self.postMessage({ type: "ready" } satisfies MarkdownDocumentWorkerResponse);

self.onmessage = (event: MessageEvent<MarkdownDocumentWorkerRequest>) => {
  const { id, text, type } = event.data;
  if (type !== "parse") {
    postMarkdownDocumentWorkerError({
      failure: "parse_failed",
      id,
      message: "Markdown document worker received an invalid request.",
    });
    return;
  }

  let document: ReturnType<typeof createMarkdownGreenfieldDocument>;
  try {
    document = createMarkdownGreenfieldDocument(text);
  } catch (error) {
    postMarkdownDocumentWorkerError({
      failure: "parse_failed",
      id,
      message:
        error instanceof Error ? error.message : "Could not parse Markdown.",
    });
    return;
  }

  try {
    assertStructuredCloneable(document);
    self.postMessage({
      document,
      id,
      ok: true,
      type: "result",
    } satisfies MarkdownDocumentWorkerResponse);
  } catch (error) {
    postMarkdownDocumentWorkerError({
      failure: "clone_failed",
      id,
      message:
        error instanceof Error
          ? error.message
          : "Markdown document worker payload is not structured-clone safe.",
    });
  }
};

function assertStructuredCloneable(value: unknown) {
  if (typeof structuredClone === "function") {
    structuredClone(value);
    return;
  }

  if (typeof MessageChannel === "function") {
    const channel = new MessageChannel();
    try {
      channel.port2.postMessage(value);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
    return;
  }

  throw new Error("Structured clone probe is unavailable.");
}

function postMarkdownDocumentWorkerError({
  failure,
  id,
  message,
}: {
  failure: "clone_failed" | "parse_failed";
  id: number;
  message: string;
}) {
  self.postMessage({
    failure,
    id,
    message,
    ok: false,
    type: "result",
  } satisfies MarkdownDocumentWorkerResponse);
}
