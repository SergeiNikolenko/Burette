import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore, type LanguageInput } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import type { CodeTokenLeaf } from "./code-viewer-syntax-protocol";

// Import only the grammars this viewer supports. Each is loaded on demand in
// the worker (or the main-thread fallback), never as part of shell startup.
const languageLoaders: Record<string, () => Promise<{ default: LanguageInput }>> = {
  bash: () => import("shiki/langs/bash.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  markup: () => import("shiki/langs/html.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

// Keep tokens semantic: existing DOM projections and Markdown sanitization
// consume { kind, text }, and CSS owns light/dark colours without retokenizing.
const theme = createCssVariablesTheme({ fontStyle: false });
theme.tokenColors?.push(
  { scope: ["constant.numeric"], settings: { foreground: "var(--shiki-token-number)" } },
  { scope: ["support.type.property-name", "variable.other.property"], settings: { foreground: "var(--shiki-token-property)" } },
);
const tokenKinds: Record<string, string> = {
  "var(--shiki-token-comment)": "comment",
  "var(--shiki-token-string)": "string",
  "var(--shiki-token-string-expression)": "string",
  "var(--shiki-token-constant)": "constant",
  "var(--shiki-token-keyword)": "keyword",
  "var(--shiki-token-parameter)": "variable",
  "var(--shiki-token-function)": "function",
  "var(--shiki-token-punctuation)": "punctuation",
  "var(--shiki-token-link)": "url",
  "var(--shiki-token-number)": "number",
  "var(--shiki-token-property)": "property",
  "var(--shiki-token-inserted)": "inserted",
  "var(--shiki-token-deleted)": "deleted",
  "var(--shiki-token-changed)": "changed",
};
let highlighter: HighlighterCore | undefined;
let initialization: Promise<HighlighterCore> | undefined;
const loadingLanguages = new Map<string, Promise<void>>();
const loadedLanguages = new Set<string>();

export function isCodeLanguageLoaded(languageId: string) {
  return loadedLanguages.has(languageId);
}

export function isCodeLanguageSupported(languageId: string) {
  return Object.hasOwn(languageLoaders, languageId);
}

export async function ensureCodeLanguage(languageId: string) {
  if (!isCodeLanguageSupported(languageId)) {
    throw new Error(`Unsupported code syntax language: ${languageId}`);
  }
  let loading = loadingLanguages.get(languageId);
  if (!loading) {
    initialization ??= createHighlighterCore({
      themes: [theme],
      langs: [],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
    loading = Promise.all([initialization, languageLoaders[languageId]!()]).then(async ([engine, grammar]) => {
      await engine.loadLanguage(grammar.default);
      highlighter = engine;
      loadedLanguages.add(languageId);
    });
    loadingLanguages.set(languageId, loading);
  }
  await loading;
}

export function tokenizeCodeLine(languageId: string, line: string): CodeTokenLeaf[] | null {
  if (!highlighter || !isCodeLanguageLoaded(languageId)) return null;
  const tokens = highlighter.codeToTokensBase(line, {
    lang: languageId === "markup" ? "html" : languageId,
    theme: theme.name,
  });
  // This API handles one source line; keeping the existing line-local contract
  // preserves bounded caches and visible-range worker requests.
  return (tokens[0] ?? []).map(token => ({
    kind: tokenKinds[token.color ?? ""] ?? "",
    text: token.content,
  }));
}
