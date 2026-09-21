import type { DockArea, DockTabKind } from "./dock";
import { resolveDropActionChoices, type DropSourceContext, type DropTargetContext } from "./drop-actions";
import type { DropAction } from "./drop-actions";
import type { StructureDragPayload, StructureDragPoint } from "./structure-drag";

export type DropPreviewTarget =
  | DropTargetContext
  | {
      kind: "dock";
      area: DockArea;
      tabKind: DockTabKind;
    };

export type DropPreviewBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type FileDropPreview = {
  actionLabel: string;
  bounds: DropPreviewBounds;
  choiceCount: number;
  itemLabel: string;
  point: StructureDragPoint;
  targetKind: "dock" | "fep" | "ketcher" | "sidebar" | "tab-strip" | "viewer" | "workspace";
  targetLabel: string;
};

export function buildFileDropPreview({
  payload,
  target,
  source,
  bounds,
  point,
  fallbackItemCount = 0,
}: {
  payload: StructureDragPayload;
  target: DropPreviewTarget;
  source: DropSourceContext;
  bounds: DropPreviewBounds;
  point: StructureDragPoint;
  fallbackItemCount?: number;
}): FileDropPreview {
  const choices = target.kind === "dock"
    ? []
    : resolveDropActionChoices(payload, target, source);
  const previewTarget = target.kind !== "dock"
    && target.kind !== "sidebar"
    && target.kind !== "tab-strip"
    && dropActionUsesWorkspace(choices[0]?.action.kind)
    ? { kind: "workspace" } as const
    : target;
  return {
    actionLabel: target.kind === "dock"
      ? `Open in ${target.area} dock`
      : choices[0]?.label ?? "Open files",
    bounds,
    choiceCount: choices.length,
    itemLabel: dropItemLabel(payload, fallbackItemCount),
    point,
    targetKind: previewTargetKind(previewTarget),
    targetLabel: previewTargetLabel(previewTarget),
  };
}

function dropActionUsesWorkspace(kind: DropAction["kind"] | undefined) {
  return kind === "open-documents"
    || kind === "open-documents-combined-poses"
    || kind === "open-documents-combined-grid"
    || kind === "open-text-files"
    || kind === "open-structure-records";
}

function previewTargetKind(target: DropPreviewTarget): FileDropPreview["targetKind"] {
  if (target.kind === "active-viewer") return "viewer";
  if (target.kind === "fep-setup") return "fep";
  return target.kind;
}

function previewTargetLabel(target: DropPreviewTarget) {
  if (target.kind === "active-viewer") return fileName(target.documentPath);
  if (target.kind === "dock") {
    return target.area === "right" ? "Right dock" : "Bottom dock";
  }
  if (target.kind === "fep-setup") return "FEP setup";
  if (target.kind === "ketcher") return "Ketcher";
  if (target.kind === "sidebar") return "Sidebar";
  if (target.kind === "tab-strip") return "Tab bar";
  return "Workspace";
}

function dropItemLabel(payload: StructureDragPayload, fallbackItemCount: number) {
  const labels = [
    ...payload.paths.map(fileName),
    ...payload.records.map((record) => fileName(record.path)),
    ...(payload.items ?? []).map((item) => item.title.trim()).filter(Boolean),
  ];
  const count = Math.max(labels.length, fallbackItemCount);
  if (count === 1) return labels[0] ?? "1 file";
  if (count > 1) return `${count} items`;
  return "Files";
}

function fileName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}
