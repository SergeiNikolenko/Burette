import { useEffect, useRef } from "react";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { forceParsing, type LanguageDescription } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import {
  prosemarkBaseThemeSetup,
  prosemarkBasicSetup,
  prosemarkMarkdownSyntaxExtensions,
} from "@prosemark/core";
import type { TextFileDocument } from "../../types";
import { htmlBlockParserExtension, markdownHtmlBlockDecorations } from "./markdown-html-block-decorations";
import { markdownImageSrcResolver } from "./markdown-image-src-resolver";
import { markdownLinkNavigation, type MarkdownOpenPaths } from "./markdown-link-navigation";
import { markdownMermaidDecorations } from "./markdown-mermaid-decorations";
import { markdownTableDecorations } from "./markdown-table-decorations";

const VIEWPORT_OVERSHOOT = 2000;
const VIEWPORT_PARSE_BUDGET_MS = 50;
const IDLE_PARSE_BUDGET_MS = 50;
const IDLE_PARSE_TIMEOUT_MS = 2000;
const AGENT_SHELL_BUILD = import.meta.env.VITE_BURETTE_AGENT_SHELL === "1";

function invisibleSearchPanel() {
  const dom = document.createElement("div");
  dom.style.display = "none";
  return { dom };
}

function advanceViewportParse(view: EditorView, isDisposed: () => boolean) {
  const viewport = view.viewport;
  const target = Math.min(view.state.doc.length, viewport.to + VIEWPORT_OVERSHOOT);
  forceParsing(view, target, VIEWPORT_PARSE_BUDGET_MS);

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(
      () => {
        if (isDisposed()) return;
        forceParsing(view, view.state.doc.length, IDLE_PARSE_BUDGET_MS);
      },
      { timeout: IDLE_PARSE_TIMEOUT_MS },
    );
  }
}

export function MarkdownRichViewer({
  document,
  openPaths,
}: {
  document: TextFileDocument;
  openPaths?: MarkdownOpenPaths;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return undefined;

    let disposed = false;
    let view: EditorView | null = null;
    void loadCodeLanguages().then((languages) => {
      if (disposed) return;
      view = new EditorView({
        parent,
        state: EditorState.create({
          doc: document.content,
          extensions: [
            markdown({
              codeLanguages: languages,
              extensions: [GFM, prosemarkMarkdownSyntaxExtensions, htmlBlockParserExtension],
            }),
            markdownLinkNavigation(() => document.path, () => disposed, openPaths),
            prosemarkBasicSetup(),
            drawSelection(),
            prosemarkBaseThemeSetup(),
            search({ literal: true, createPanel: invisibleSearchPanel }),
            markdownTableDecorations(),
            markdownHtmlBlockDecorations(),
            markdownMermaidDecorations(),
            markdownImageSrcResolver(() => document.path),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            keymap.of([...searchKeymap, ...defaultKeymap]),
          ],
        }),
      });

      advanceViewportParse(view, () => disposed);
    });

    return () => {
      disposed = true;
      view?.destroy();
      view = null;
    };
  }, [document, openPaths]);

  return <div ref={parentRef} className="text-file-rich-editor" />;
}

async function loadCodeLanguages(): Promise<LanguageDescription[]> {
  if (AGENT_SHELL_BUILD) return [];
  return (await import("@codemirror/language-data")).languages;
}
