import { describe, expect, test } from "bun:test";
import { ensureCodeLanguage, isCodeLanguageLoaded, isCodeLanguageSupported, tokenizeCodeLine } from "../apps/desktop/src/components/ui/code-viewer-syntax-shiki";
import { markdownCodeTokensToHtml } from "../apps/desktop/src/components/ui/markdown-greenfield-code-highlight-html";

const examples: Record<string, string> = {
  bash: 'echo "$HOME"', css: '.panel { color: red; }', diff: '+added',
  dockerfile: 'FROM node:22', go: 'var answer int = 42', java: 'int answer = 42;',
  javascript: 'const answer = "hello";', json: '{"answer": 42}', jsx: '<Panel count={42} />',
  markdown: '[hello](https://example.com)', markup: '<span title="hello">世界</span>', python: 'answer = "hello" # comment',
  ruby: 'answer = "hello"', rust: 'let answer: i32 = 42;', sql: 'SELECT name FROM molecules;',
  tsx: '<Panel count={42} />', typescript: 'const answer: number = 42; // hello', yaml: 'answer: 42',
};

describe("Shiki viewer adapter", () => {
  for (const [language, line] of Object.entries(examples)) {
    test(`${language} loads once and preserves source text`, async () => {
      expect(isCodeLanguageSupported(language)).toBe(true);
      await Promise.all([ensureCodeLanguage(language), ensureCodeLanguage(language)]);
      expect(isCodeLanguageLoaded(language)).toBe(true);
      const tokens = tokenizeCodeLine(language, line)!;
      expect(tokens.map(token => token.text).join("")).toBe(line);
      expect(tokens.some(token => token.kind !== "")).toBe(true);
    });
  }

  test("classifies number, keyword and comment independently", async () => {
    await ensureCodeLanguage("typescript");
    const tokens = tokenizeCodeLine("typescript", examples.typescript!)!;
    expect(tokens).toContainEqual({ kind: "keyword", text: "const" });
    expect(tokens).toContainEqual({ kind: "number", text: "42" });
    expect(tokens).toContainEqual({ kind: "comment", text: "// hello" });
  });

  test("unsupported language stays plain and does not resolve prototype properties", async () => {
    expect(isCodeLanguageSupported("constructor")).toBe(false);
    expect(tokenizeCodeLine("unknown", "text")).toBeNull();
    await expect(ensureCodeLanguage("unknown")).rejects.toThrow("Unsupported");
  });

  test("Markdown projection escapes source and keeps find highlighting", async () => {
    await ensureCodeLanguage("markup");
    const line = '<script>alert("<&")</script>';
    const html = markdownCodeTokensToHtml({ line, tokens: tokenizeCodeLine("markup", line), highlightPattern: "alert" })!;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;");
    expect(html).toContain('data-highlighted-chars=""');
    expect(html).toContain("alert");
  });
});
