import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

type StructureLanguage = "pdb" | "cif" | "gro" | "xyz" | "sdf" | "mol2" | "cube" | "maestro";

const recordMark = Decoration.mark({ class: "cm-structure-record" });
const atomMark = Decoration.mark({ class: "cm-structure-atom" });
const residueMark = Decoration.mark({ class: "cm-structure-residue" });
const chainMark = Decoration.mark({ class: "cm-structure-chain" });
const numberMark = Decoration.mark({ class: "cm-structure-number" });
const keywordMark = Decoration.mark({ class: "cm-structure-keyword" });
const propertyMark = Decoration.mark({ class: "cm-structure-property" });
const commentMark = Decoration.mark({ class: "cm-structure-comment" });
let activeLineLength = 0;

export function structureTextHighlighting(extension: string): Extension {
  const language = structureLanguageForExtension(extension);
  if (!language) return [];
  const resolvedLanguage = language;
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, resolvedLanguage);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view, resolvedLanguage);
        }
      },
      {
        decorations: (value) => value.decorations,
      },
    ),
  ];
}

export function textNumberHighlighting(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildNumberDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = buildNumberDecorations(update.view);
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  );
}

export function hasStructureTextHighlighting(extension: string) {
  return structureLanguageForExtension(extension) !== null;
}

function structureLanguageForExtension(extension: string): StructureLanguage | null {
  const normalized = extension.toLowerCase();
  if (["pdb", "pdbqt", "ent"].includes(normalized)) return "pdb";
  if (["cif", "mmcif"].includes(normalized)) return "cif";
  if (normalized === "gro") return "gro";
  if (["xyz", "extxyz"].includes(normalized)) return "xyz";
  if (["sdf", "mol"].includes(normalized)) return "sdf";
  if (normalized === "mol2") return "mol2";
  if (["cube", "cub"].includes(normalized)) return "cube";
  if (["mae", "maegz", "cms"].includes(normalized)) return "maestro";
  return null;
}

function buildDecorations(view: EditorView, language: StructureLanguage) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    let position = range.from;
    while (position <= range.to) {
      const line = view.state.doc.lineAt(position);
      highlightLine(builder, language, line.from, line.text, line.number);
      position = line.to + 1;
    }
  }
  return builder.finish();
}

function buildNumberDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    let position = range.from;
    while (position <= range.to) {
      const line = view.state.doc.lineAt(position);
      activeLineLength = line.text.length;
      highlightNumbers(builder, line.from, line.text, 0);
      position = line.to + 1;
    }
  }
  return builder.finish();
}

function highlightLine(builder: RangeSetBuilder<Decoration>, language: StructureLanguage, from: number, text: string, lineNumber: number) {
  activeLineLength = text.length;
  if (language === "pdb") return highlightPdbLine(builder, from, text);
  if (language === "cif") return highlightCifLine(builder, from, text);
  if (language === "gro") return highlightGroLine(builder, from, text, lineNumber);
  if (language === "xyz") return highlightXyzLine(builder, from, text, lineNumber);
  if (language === "sdf") return highlightSdfLine(builder, from, text, lineNumber);
  if (language === "mol2") return highlightMol2Line(builder, from, text);
  if (language === "maestro") return highlightMaestroLine(builder, from, text);
  highlightCubeLine(builder, from, text, lineNumber);
}

function highlightPdbLine(builder: RangeSetBuilder<Decoration>, from: number, text: string) {
  const record = text.slice(0, 6).trim();
  if (!record) return;
  markRange(builder, from, 0, Math.min(6, text.length), recordMark);
  if (record === "ATOM" || record === "HETATM" || record === "ANISOU") {
    markRange(builder, from, 6, 11, numberMark);
    markRange(builder, from, 12, 16, atomMark);
    markRange(builder, from, 17, 20, residueMark);
    markRange(builder, from, 21, 22, chainMark);
    markRange(builder, from, 22, 27, numberMark);
    markRange(builder, from, 30, 54, numberMark);
    markRange(builder, from, 54, 66, numberMark);
    markRange(builder, from, 76, 78, atomMark);
    return;
  }
  if (["HEADER", "TITLE", "COMPND", "SOURCE", "KEYWDS", "EXPDTA", "AUTHOR", "REMARK", "SEQRES", "HELIX", "SHEET", "SITE", "MODEL", "ENDMDL", "CONECT"].includes(record)) {
    markRange(builder, from, 6, text.length, record === "REMARK" ? commentMark : keywordMark);
  }
}

function highlightCifLine(builder: RangeSetBuilder<Decoration>, from: number, text: string) {
  const trimmed = text.trimStart();
  const offset = text.length - trimmed.length;
  if (!trimmed) return;
  if (trimmed.startsWith("#")) {
    markRange(builder, from, offset, text.length, commentMark);
    return;
  }
  if (trimmed.startsWith("data_") || trimmed === "loop_" || trimmed.startsWith("save_")) {
    markRange(builder, from, offset, offset + firstTokenLength(trimmed), recordMark);
    return;
  }
  if (trimmed.startsWith("_")) {
    const keyLength = firstTokenLength(trimmed);
    markRange(builder, from, offset, offset + keyLength, propertyMark);
    highlightNumbers(builder, from, text, offset + keyLength);
    return;
  }
  highlightNumbers(builder, from, text, offset);
}

function highlightGroLine(builder: RangeSetBuilder<Decoration>, from: number, text: string, lineNumber: number) {
  if (lineNumber === 1) {
    markRange(builder, from, 0, text.length, commentMark);
    return;
  }
  if (lineNumber === 2 || text.trim().split(/\s+/).length === 3) {
    highlightNumbers(builder, from, text, 0);
    return;
  }
  if (text.length < 20) return;
  markRange(builder, from, 0, 5, numberMark);
  markRange(builder, from, 5, 10, residueMark);
  markRange(builder, from, 10, 15, atomMark);
  markRange(builder, from, 15, 20, numberMark);
  highlightNumbers(builder, from, text, 20);
}

function highlightXyzLine(builder: RangeSetBuilder<Decoration>, from: number, text: string, lineNumber: number) {
  if (lineNumber === 1) {
    highlightNumbers(builder, from, text, 0);
    return;
  }
  if (lineNumber === 2) {
    markRange(builder, from, 0, text.length, commentMark);
    return;
  }
  const elementMatch = text.match(/^\s*[A-Za-z]{1,3}/);
  if (elementMatch) markRange(builder, from, elementMatch.index ?? 0, (elementMatch.index ?? 0) + elementMatch[0].length, atomMark);
  highlightNumbers(builder, from, text, elementMatch?.[0].length ?? 0);
}

function highlightSdfLine(builder: RangeSetBuilder<Decoration>, from: number, text: string, lineNumber: number) {
  if (text === "$$$$" || text.startsWith("M  ") || text.startsWith("V2000") || text.startsWith("V3000")) {
    markRange(builder, from, 0, text.length, recordMark);
    return;
  }
  const property = text.match(/^>\s*<[^>]+>/);
  if (property) {
    markRange(builder, from, 0, property[0].length, propertyMark);
    return;
  }
  if (lineNumber >= 4) {
    const atomLine = text.match(/^\s*-?\d+\.\d+\s+-?\d+\.\d+\s+-?\d+\.\d+\s+([A-Za-z]{1,3})\b/);
    if (atomLine) {
      highlightNumbers(builder, from, text, 0);
      markRange(builder, from, atomLine.index! + atomLine[0].lastIndexOf(atomLine[1]), atomLine.index! + atomLine[0].lastIndexOf(atomLine[1]) + atomLine[1].length, atomMark);
      return;
    }
    highlightNumbers(builder, from, text, 0);
  }
}

function highlightMol2Line(builder: RangeSetBuilder<Decoration>, from: number, text: string) {
  if (text.startsWith("@<TRIPOS>")) {
    markRange(builder, from, 0, text.length, recordMark);
    return;
  }
  const atomLine = text.match(/^\s*\d+\s+\S+\s+-?\d/);
  if (atomLine) {
    highlightNumbers(builder, from, text, 0);
    const parts = [...text.matchAll(/\S+/g)];
    if (parts[1]) markRange(builder, from, parts[1].index ?? 0, (parts[1].index ?? 0) + parts[1][0].length, atomMark);
    if (parts[5]) markRange(builder, from, parts[5].index ?? 0, (parts[5].index ?? 0) + parts[5][0].length, residueMark);
  }
}

function highlightCubeLine(builder: RangeSetBuilder<Decoration>, from: number, text: string, lineNumber: number) {
  if (lineNumber <= 2) {
    markRange(builder, from, 0, text.length, commentMark);
    return;
  }
  highlightNumbers(builder, from, text, 0);
}

function highlightMaestroLine(builder: RangeSetBuilder<Decoration>, from: number, text: string) {
  const trimmed = text.trimStart();
  const offset = text.length - trimmed.length;
  if (!trimmed) return;
  if (trimmed.startsWith("#")) {
    markRange(builder, from, offset, text.length, commentMark);
    return;
  }
  const record = trimmed.match(/^[A-Za-z][A-Za-z0-9_]*(?=\s*(?:\[|\{|\())/);
  if (record) {
    markRange(builder, from, offset, offset + record[0].length, recordMark);
    highlightNumbers(builder, from, text, offset + record[0].length);
    return;
  }
  const property = trimmed.match(/^[a-z]_[A-Za-z0-9_]+/);
  if (property) {
    markRange(builder, from, offset, offset + property[0].length, propertyMark);
    highlightNumbers(builder, from, text, offset + property[0].length);
    return;
  }
  highlightNumbers(builder, from, text, offset);
}

function highlightNumbers(builder: RangeSetBuilder<Decoration>, from: number, text: string, start: number) {
  const numberPattern = /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[Ee][-+]?\d+)?/g;
  const offset = Math.max(0, start);
  const slice = text.slice(offset);
  for (const match of slice.matchAll(numberPattern)) {
    const index = offset + (match.index ?? 0);
    markRange(builder, from, index, index + match[0].length, numberMark);
  }
}

function firstTokenLength(text: string) {
  return text.match(/^\S+/)?.[0].length ?? text.length;
}

function markRange(builder: RangeSetBuilder<Decoration>, from: number, start: number, end: number, mark: Decoration) {
  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(Math.max(clampedStart, end), activeLineLength);
  if (clampedEnd <= clampedStart) return;
  builder.add(from + clampedStart, from + clampedEnd, mark);
}
