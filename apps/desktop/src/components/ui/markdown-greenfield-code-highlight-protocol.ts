export const MARKDOWN_CODE_HIGHLIGHT_BATCH_SIZE = 64;
export const MARKDOWN_CODE_HIGHLIGHT_CACHE_LIMIT = 4096;
export const MARKDOWN_CODE_HIGHLIGHT_RENDERER_VERSION = 1;

export type MarkdownCodeHighlightLineRequest = {
  index: number;
  line: string;
};

export type MarkdownCodeHighlightLineResult = {
  html: string | null;
  index: number;
};

export type MarkdownCodeHighlightWorkerRequest = {
  generation: number;
  highlightPattern: string;
  languageId: string;
  lines: MarkdownCodeHighlightLineRequest[];
  requestId: number;
  type: "highlight";
};

export type MarkdownCodeHighlightWorkerResponse =
  | {
      generation: number;
      languageId: string;
      requestId: number;
      results: MarkdownCodeHighlightLineResult[];
      type: "highlighted";
    }
  | {
      generation: number;
      languageId: string;
      message: string;
      requestId: number;
      type: "error";
    };
