import Prism from "prismjs";

import type { CodeTokenLeaf } from "./code-viewer-syntax-protocol";

Prism.manual = true;

const coreLanguages = new Set(["css", "javascript", "markup"]);
const languageLoaders: Record<string, () => Promise<unknown>> = {
  bash: () => import("prismjs/components/prism-bash"),
  diff: () => import("prismjs/components/prism-diff"),
  dockerfile: () => import("prismjs/components/prism-docker"),
  go: () => import("prismjs/components/prism-go"),
  java: () => import("prismjs/components/prism-java"),
  json: () => import("prismjs/components/prism-json"),
  jsx: () => import("prismjs/components/prism-jsx"),
  markdown: () => import("prismjs/components/prism-markdown"),
  python: () => import("prismjs/components/prism-python"),
  rust: () => import("prismjs/components/prism-rust"),
  ruby: () => import("prismjs/components/prism-ruby"),
  sql: () => import("prismjs/components/prism-sql"),
  tsx: async () => {
    await Promise.all([
      import("prismjs/components/prism-typescript"),
      import("prismjs/components/prism-jsx"),
    ]);
    return import("prismjs/components/prism-tsx");
  },
  typescript: () => import("prismjs/components/prism-typescript"),
  yaml: () => import("prismjs/components/prism-yaml"),
};

const loadingLanguages = new Map<string, Promise<void>>();

export function isCodePrismLanguageLoaded(languageId: string) {
  return Boolean(Prism.languages[languageId]);
}

export function isCodePrismLanguageSupported(languageId: string) {
  return coreLanguages.has(languageId) || languageId in languageLoaders;
}

export async function ensureCodePrismLanguage(languageId: string) {
  if (isCodePrismLanguageLoaded(languageId)) return;
  if (coreLanguages.has(languageId)) return;

  let loading = loadingLanguages.get(languageId);
  if (!loading) {
    const loadLanguage = languageLoaders[languageId];
    if (!loadLanguage) {
      loading = Promise.reject(
        new Error(`Unsupported code syntax language: ${languageId}`),
      );
    } else {
      loading = loadLanguage().then(() => undefined);
    }
    loadingLanguages.set(languageId, loading);
  }

  await loading;
}

export function tokenizeCodeLine(languageId: string, line: string) {
  const grammar = Prism.languages[languageId] ?? null;
  if (!grammar) return null;
  return flattenCodeTokens(Prism.tokenize(line, grammar));
}

function flattenCodeTokens(
  tokens: Array<string | Prism.Token>,
  parentKind = "",
  leaves: CodeTokenLeaf[] = [],
): CodeTokenLeaf[] {
  for (const token of tokens) {
    if (typeof token === "string") {
      leaves.push({ kind: parentKind, text: token });
    } else if (Array.isArray(token.content)) {
      flattenCodeTokens(
        token.content as Array<string | Prism.Token>,
        token.type,
        leaves,
      );
    } else if (typeof token.content === "string") {
      leaves.push({ kind: token.type, text: token.content });
    } else {
      flattenCodeTokens([token.content as Prism.Token], token.type, leaves);
    }
  }
  return leaves;
}
