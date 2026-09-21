export const CODE_LINE_TOKENIZE_MAX = 2000;

export type CodeTokenLeaf = {
  kind: string;
  text: string;
};

export type CodeSyntaxWorkerRequest = {
  type: "tokenize";
  requestId: number;
  generation: number;
  languageId: string;
  lines: string[];
};

export type CodeSyntaxWorkerResponse =
  | {
      type: "tokens";
      requestId: number;
      generation: number;
      languageId: string;
      results: CodeSyntaxWorkerTokenResult[];
    }
  | {
      type: "error";
      requestId: number;
      generation: number;
      languageId: string;
      message: string;
    };

export type CodeSyntaxWorkerTokenResult = {
  line: string;
  tokens: CodeTokenLeaf[] | null;
};

export function shouldTokenizeCodeLine(line: string) {
  return line.length > 0 && line.length <= CODE_LINE_TOKENIZE_MAX;
}
