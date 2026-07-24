import { useEffect, useMemo, useRef } from "react";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { formatBytes } from "./format";
import type { TextFileDocument } from "../types";
import { textStructureSelectionFromRange, textStructureSelectionFromSelectedText, type TextStructureSelection } from "../lib/text-structure-selection";
import { MarkdownRichViewer } from "./text-file-viewer/markdown-rich-viewer";
import { MaestroOutlineViewer } from "./text-file-viewer/maestro-outline-viewer";
import type { MarkdownOpenPaths } from "./text-file-viewer/markdown-link-navigation";
import { hasStructureTextHighlighting, structureTextHighlighting, textNumberHighlighting } from "./text-file-viewer/structure-text-highlighting";
import { Button } from "./ui/button";

const AGENT_SHELL_BUILD = import.meta.env.VITE_BURETTE_AGENT_SHELL === "1";

export function TextFileViewer({
  document,
  openPaths,
  onStructureSelection,
  sourceEditing,
}: {
  document: TextFileDocument;
  openPaths?: MarkdownOpenPaths;
  onStructureSelection?: (document: TextFileDocument, selection: TextStructureSelection) => void;
  sourceEditing?: {
    editable: boolean;
    content: string;
    status: string;
    dirty: boolean;
    saving: boolean;
    diagnostic?: string | null;
    saveDisabledReason?: string | null;
    showApplyPreview?: boolean;
    onBeginEditing?: () => void;
    onChange?: (content: string) => void;
    onSave?: () => void | Promise<void>;
    onApplyPreview?: () => void | Promise<void>;
  };
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const selectionTimeoutRef = useRef<number | null>(null);
  const onStructureSelectionRef = useRef(onStructureSelection);
  const onContentChangeRef = useRef(sourceEditing?.onChange);
  const saveSourceRef = useRef(sourceEditing?.onSave);
  const documentRef = useRef(document);
  const syncingContentRef = useRef(false);
  const lastStructureSelectionKeyRef = useRef<string | null>(null);
  const lineDragStartRef = useRef<{ from: number; to: number } | null>(null);
  const languageCompartment = useMemo(() => new Compartment(), [document.id]);
  const markdownDocument = isMarkdown(document);
  const maestroDocument = isMaestroText(document);
  const editorContent = sourceEditing?.content ?? document.content;
  const editable = Boolean(sourceEditing?.editable);

  useEffect(() => {
    onStructureSelectionRef.current = onStructureSelection;
  }, [onStructureSelection]);

  useEffect(() => {
    onContentChangeRef.current = sourceEditing?.onChange;
    saveSourceRef.current = sourceEditing?.onSave;
    documentRef.current = document;
  }, [document, sourceEditing?.onChange, sourceEditing?.onSave]);

  useEffect(() => {
    if (markdownDocument || maestroDocument) return undefined;
    const parent = parentRef.current;
    if (!parent) return undefined;

    const emitStructureSelection = (selection: TextStructureSelection) => {
      const selectionKey = JSON.stringify([selection.granularity, selection.selector, selection.lineCount]);
      if (selectionKey === lastStructureSelectionKeyRef.current) return;
      lastStructureSelectionKeyRef.current = selectionKey;
      if (selectionTimeoutRef.current !== null) {
        window.clearTimeout(selectionTimeoutRef.current);
      }
      selectionTimeoutRef.current = window.setTimeout(() => {
        selectionTimeoutRef.current = null;
        onStructureSelectionRef.current?.(document, selection);
      }, 120);
    };

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: editorContent,
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
          ...(editable
            ? [EditorState.readOnly.of(false), EditorView.editable.of(true)]
            : [EditorState.readOnly.of(true), EditorView.editable.of(false)]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingContentRef.current) {
              onContentChangeRef.current?.(update.state.doc.toString());
            }
            if (!update.selectionSet) return;
            const range = update.state.selection.main;
            if (range.empty) return;
            const selection = textStructureSelectionFromRange(documentRef.current, range.from, range.to);
            if (selection) emitStructureSelection(selection);
          }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                if (!saveSourceRef.current) return false;
                void saveSourceRef.current();
                return true;
              },
            },
            ...searchKeymap,
            ...defaultKeymap,
          ]),
          textViewerTheme,
          languageCompartment.of(baseLanguageSupport(document)),
        ],
      }),
    });
    viewRef.current = view;
    const lineRangeFromElement = (lineElement: HTMLElement) => {
      const line = view.state.doc.lineAt(view.posAtDOM(lineElement, 0));
      return { from: line.from, to: line.to };
    };
    const lineElementFromEvent = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".cm-line") : null;
      return target && parent.contains(target) ? target : null;
    };
    const emitStructureRange = (from: number, to: number) => {
      const structureSelection = textStructureSelectionFromRange(documentRef.current, from, to);
      if (structureSelection) emitStructureSelection(structureSelection);
    };
    const emitLineDragStructureSelection = (lineElement: HTMLElement) => {
      try {
        const line = lineRangeFromElement(lineElement);
        const start = lineDragStartRef.current ?? line;
        emitStructureRange(Math.min(start.from, line.from), Math.max(start.to, line.to));
      } catch (_) {
        // CodeMirror can recycle virtualized line nodes while a pointer drag is settling.
      }
    };
    const emitNativeStructureSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      if (!selection.anchorNode || !parent.contains(selection.anchorNode)) return;
      if (!selection.focusNode || !parent.contains(selection.focusNode)) return;
      const selectedTextStructureSelection = textStructureSelectionFromSelectedText(documentRef.current, selection.toString());
      if (selectedTextStructureSelection) {
        emitStructureSelection(selectedTextStructureSelection);
        return;
      }
      const range = selection.getRangeAt(0);
      const selectedDocumentLines: Array<{ from: number; to: number }> = [];
      for (const lineElement of parent.querySelectorAll<HTMLElement>(".cm-line")) {
        try {
          if (!range.intersectsNode(lineElement)) continue;
          const line = view.state.doc.lineAt(view.posAtDOM(lineElement, 0));
          selectedDocumentLines.push({ from: line.from, to: line.to });
        } catch (_) {
          // CodeMirror can recycle virtualized line nodes while a native selection is settling.
        }
      }
      if (selectedDocumentLines.length === 0) return;
      const from = Math.min(...selectedDocumentLines.map((line) => line.from));
      const to = Math.max(...selectedDocumentLines.map((line) => line.to));
      const structureSelection = textStructureSelectionFromRange(documentRef.current, from, to);
      if (structureSelection) emitStructureSelection(structureSelection);
    };
    window.document.addEventListener("selectionchange", emitNativeStructureSelection);
    parent.addEventListener("mouseup", emitNativeStructureSelection);
    parent.addEventListener("keyup", emitNativeStructureSelection);
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = lineElementFromEvent(event);
      if (!target) return;
      try {
        lineDragStartRef.current = lineRangeFromElement(target);
        emitLineDragStructureSelection(target);
      } catch (_) {
        lineDragStartRef.current = null;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const target = lineElementFromEvent(event);
      if (lineDragStartRef.current) {
        if ((event.buttons & 1) !== 1) {
          lineDragStartRef.current = null;
        } else if (target) {
          emitLineDragStructureSelection(target);
        }
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const target = lineElementFromEvent(event);
      if (lineDragStartRef.current && target) emitLineDragStructureSelection(target);
      lineDragStartRef.current = null;
      emitNativeStructureSelection();
    };
    const onPointerCancel = () => {
      lineDragStartRef.current = null;
    };
    const onPointerLeave = () => {
      lineDragStartRef.current = null;
    };
    parent.addEventListener("pointerdown", onPointerDown);
    parent.addEventListener("pointermove", onPointerMove);
    parent.addEventListener("pointerup", onPointerUp);
    parent.addEventListener("pointercancel", onPointerCancel);
    parent.addEventListener("pointerleave", onPointerLeave);
    return () => {
      if (selectionTimeoutRef.current !== null) {
        window.clearTimeout(selectionTimeoutRef.current);
        selectionTimeoutRef.current = null;
      }
      lineDragStartRef.current = null;
      window.document.removeEventListener("selectionchange", emitNativeStructureSelection);
      parent.removeEventListener("mouseup", emitNativeStructureSelection);
      parent.removeEventListener("keyup", emitNativeStructureSelection);
      parent.removeEventListener("pointerdown", onPointerDown);
      parent.removeEventListener("pointermove", onPointerMove);
      parent.removeEventListener("pointerup", onPointerUp);
      parent.removeEventListener("pointercancel", onPointerCancel);
      parent.removeEventListener("pointerleave", onPointerLeave);
      view.destroy();
      viewRef.current = null;
    };
  }, [document.id, editable, languageCompartment, markdownDocument, maestroDocument]);

  useEffect(() => {
    if (markdownDocument || maestroDocument) return;
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === editorContent) return;
    syncingContentRef.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: editorContent },
    });
    syncingContentRef.current = false;
  }, [editorContent, markdownDocument, maestroDocument]);

  useEffect(() => {
    if (markdownDocument || maestroDocument) return undefined;
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
  }, [document, languageCompartment, markdownDocument, maestroDocument]);

  return (
    <div className="text-file-stage">
      <div className="text-file-toolbar">
        <div className="text-file-title">
          <span>{document.title}</span>
          {document.truncated && <span className="text-file-badge">Truncated</span>}
        </div>
        <div className="text-file-meta">
          {sourceEditing && (
            <span className="source-edit-status" aria-live="polite">
              {sourceEditing.dirty && <span className="source-edit-dirty" aria-label="Unsaved changes">●</span>}
              {sourceEditing.status}
            </span>
          )}
          <span>{document.language}</span>
          <span>{formatBytes(new TextEncoder().encode(editorContent).byteLength)}</span>
          {sourceEditing?.onBeginEditing && !sourceEditing.editable && (
            <Button type="button" variant="secondary" size="xs" onClick={sourceEditing.onBeginEditing}>Edit Source</Button>
          )}
          {sourceEditing?.showApplyPreview && sourceEditing.editable && (
            <Button type="button" variant="secondary" size="xs" onClick={() => void sourceEditing.onApplyPreview?.()}>Apply Preview</Button>
          )}
          {sourceEditing?.editable && (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={sourceEditing.saving || Boolean(sourceEditing.saveDisabledReason) || !sourceEditing.dirty}
              title={sourceEditing.saveDisabledReason ?? "Save source (Command-S)"}
              onClick={() => void sourceEditing.onSave?.()}
            >
              Save
            </Button>
          )}
        </div>
      </div>
      {sourceEditing?.diagnostic && (
        <div className="source-edit-diagnostic" role="status">{sourceEditing.diagnostic}</div>
      )}
      {markdownDocument ? (
        <MarkdownRichViewer document={document} openPaths={openPaths} />
      ) : maestroDocument ? (
        <MaestroOutlineViewer document={document} />
      ) : (
        <div ref={parentRef} className="text-file-editor" />
      )}
    </div>
  );
}

function baseLanguageSupport(document: TextFileDocument): Extension {
  if (isMarkdown(document)) {
    return markdown();
  }
  if (!hasStructureTextHighlighting(document.extension)) return textNumberHighlighting();
  return structureTextHighlighting(document.extension);
}

async function resolveLanguageSupport(document: TextFileDocument): Promise<Extension> {
  const languages = await loadCodeLanguages();
  if (isMarkdown(document)) return markdown({ codeLanguages: languages });
  if (hasStructureTextHighlighting(document.extension)) return structureTextHighlighting(document.extension);
  const description = LanguageDescription.matchFilename(languages, document.title) ?? matchLanguageName(document.language, languages);
  const numberHighlighting = textNumberHighlighting();
  if (!description) return numberHighlighting;
  return [await description.load(), numberHighlighting];
}

async function loadCodeLanguages(): Promise<LanguageDescription[]> {
  if (AGENT_SHELL_BUILD) return [];
  return (await import("@codemirror/language-data")).languages;
}

function matchLanguageName(language: string, languages: readonly LanguageDescription[]) {
  const normalized = language.toLowerCase();
  return languages.find((description) => (
    description.name.toLowerCase() === normalized ||
    description.alias.some((alias) => alias.toLowerCase() === normalized)
  )) ?? null;
}

function isMarkdown(document: TextFileDocument) {
  return document.language === "markdown" || ["md", "markdown", "mdx"].includes(document.extension);
}

function isMaestroText(document: TextFileDocument) {
  return document.language === "maestro" || ["mae", "maegz", "cms"].includes(document.extension.toLowerCase());
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
    fontVariantNumeric: "tabular-nums",
    fontFeatureSettings: "\"tnum\" 1, \"kern\" 0, \"liga\" 0, \"calt\" 0",
    fontKerning: "none",
    overflowX: "auto",
  },
  ".cm-content": {
    padding: "16px 0 32px",
    minHeight: "100%",
    minWidth: "100%",
    width: "max-content",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontWeight: "400",
  },
  ".cm-line": {
    padding: "0 18px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontWeight: "400",
    whiteSpace: "pre",
  },
  ".cm-line span": {
    fontFamily: "inherit",
    fontWeight: "400",
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
  ".cm-structure-record": {
    color: "color-mix(in srgb, var(--accent) 82%, var(--text-primary))",
  },
  ".cm-structure-keyword": {
    color: "var(--text-secondary)",
  },
  ".cm-structure-comment": {
    color: "var(--text-muted)",
  },
  ".cm-structure-atom": {
    color: "#168A6F",
  },
  ".cm-structure-residue": {
    color: "#9B5A00",
  },
  ".cm-structure-chain": {
    color: "#2563EB",
  },
  ".cm-structure-number, .cm-structure-number *": {
    color: "#6F5CC2",
  },
  ".cm-structure-property": {
    color: "#B0476B",
  },
  "&.cm-focused": {
    outline: "none",
  },
});
