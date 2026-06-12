import { useEffect, useMemo, useRef } from "react";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { formatBytes } from "./format";
import type { TextFileDocument } from "../types";
import { MarkdownRichViewer } from "./text-file-viewer/markdown-rich-viewer";
import type { MarkdownOpenPaths } from "./text-file-viewer/markdown-link-navigation";

export function TextFileViewer({
  document,
  openPaths,
}: {
  document: TextFileDocument;
  openPaths?: MarkdownOpenPaths;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useMemo(() => new Compartment(), [document.id]);
  const markdownDocument = isMarkdown(document);

  useEffect(() => {
    if (markdownDocument) return undefined;
    const parent = parentRef.current;
    if (!parent) return undefined;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: document.content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          keymap.of([...searchKeymap, ...defaultKeymap]),
          textViewerTheme,
          languageCompartment.of(baseLanguageSupport(document)),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [document, languageCompartment, markdownDocument]);

  useEffect(() => {
    if (markdownDocument) return undefined;
    let cancelled = false;
    const view = viewRef.current;
    if (!view) return undefined;
    void resolveLanguageSupport(document).then((support) => {
      if (cancelled || !viewRef.current) return;
      view.dispatch({
        effects: languageCompartment.reconfigure(support),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [document, languageCompartment, markdownDocument]);

  return (
    <div className="text-file-stage">
      <div className="text-file-toolbar">
        <div className="text-file-title">
          <span>{document.title}</span>
          {document.truncated && <span className="text-file-badge">Truncated</span>}
        </div>
        <div className="text-file-meta">
          <span>{document.language}</span>
          <span>{formatBytes(document.byteCount)}</span>
        </div>
      </div>
      {markdownDocument ? (
        <MarkdownRichViewer document={document} openPaths={openPaths} />
      ) : (
        <div ref={parentRef} className="text-file-editor" />
      )}
    </div>
  );
}

function baseLanguageSupport(document: TextFileDocument): Extension {
  if (isMarkdown(document)) {
    return markdown({ codeLanguages: languages });
  }
  return [];
}

async function resolveLanguageSupport(document: TextFileDocument): Promise<Extension> {
  if (isMarkdown(document)) return markdown({ codeLanguages: languages });
  const description = LanguageDescription.matchFilename(languages, document.title) ?? matchLanguageName(document.language);
  if (!description) return [];
  return description.load();
}

function matchLanguageName(language: string) {
  const normalized = language.toLowerCase();
  return languages.find((description) => (
    description.name.toLowerCase() === normalized ||
    description.alias.some((alias) => alias.toLowerCase() === normalized)
  )) ?? null;
}

function isMarkdown(document: TextFileDocument) {
  return document.language === "markdown" || ["md", "markdown", "mdx"].includes(document.extension);
}

const textViewerTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": {
    padding: "16px 0 32px",
    minHeight: "100%",
  },
  ".cm-line": {
    padding: "0 18px",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-dim)",
    border: "0",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--surface-hover) 58%, transparent)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 34%, transparent)",
  },
  "&.cm-focused": {
    outline: "none",
  },
});
