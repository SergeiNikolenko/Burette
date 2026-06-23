import type { DockingDocumentRequest, FepSetupRequest } from "../types";
import { isMoleculeCollectionPath } from "./collection-documents";
import { dockingCandidatesForDrop, isMolstarCombineSource, isMolstarCoordinateTrajectorySource, isProteinLikeDockingSource } from "./docking-documents";
import type { StructureDragPayload, StructureDragRecord } from "./structure-drag";

export type DropTargetContext =
  | {
      kind: "workspace";
    }
  | {
      kind: "ketcher";
    }
  | {
      kind: "fep-setup";
      request: FepSetupRequest;
    }
  | {
      kind: "active-viewer";
      documentId?: string | null;
      documentPath: string;
      renderer?: string | null;
      dockingRequest?: DockingDocumentRequest | null;
    };

export type DropSourceContext =
  | {
      kind: "finder" | "workspace" | "sidebar" | "tab" | "ketcher" | "grid" | "clipboard";
    }
  | {
      kind: "unknown";
    };

export type DropAction =
  | {
      kind: "merge-collection";
      targetPath: string;
      paths: string[];
    }
  | {
      kind: "append-grid-records";
      targetDocumentId: string;
      payload: StructureDragPayload;
    }
  | {
      kind: "add-xyzrender-sheet-items";
      targetDocumentId?: string | null;
      payload: StructureDragPayload;
    }
  | {
      kind: "open-docking";
      request: DockingDocumentRequest;
    }
  | {
      kind: "open-docking-with-records";
      receptorPath: string;
      ligandPaths: string[];
      records: StructureDragRecord[];
    }
  | {
      kind: "import-ketcher-structures";
      payload: StructureDragPayload;
    }
  | {
      kind: "prepare-fep-setup";
      request: FepSetupRequest;
    }
  | {
      kind: "open-documents";
      paths: string[];
    }
  | {
      kind: "open-documents-combined-poses";
      paths: string[];
    }
  | {
      kind: "open-documents-combined-grid";
      paths: string[];
    }
  | {
      kind: "open-text-files";
      paths: string[];
    }
  | {
      kind: "open-structure-records";
      paths: string[];
      records: StructureDragRecord[];
    }
  | {
      kind: "show-inline-record-target-hint";
    };

export type DropActionChoice = {
  id: string;
  label: string;
  confidence: "default" | "alternative";
  action: DropAction;
  source?: DropSourceContext;
};

const UNKNOWN_DROP_SOURCE: DropSourceContext = { kind: "unknown" };

export function resolveDropAction(
  payload: StructureDragPayload,
  target: DropTargetContext,
  source: DropSourceContext = UNKNOWN_DROP_SOURCE,
): DropAction | null {
  return resolveDropActionChoices(payload, target, source)[0]?.action ?? null;
}

export function resolveDropActionChoices(
  payload: StructureDragPayload,
  target: DropTargetContext,
  source: DropSourceContext = UNKNOWN_DROP_SOURCE,
): DropActionChoice[] {
  if (payload.paths.length === 0 && payload.records.length === 0) return [];
  if (target.kind === "workspace") return workspaceDropActionChoices(payload, source);
  if (target.kind === "ketcher") {
    const importPayload = ketcherImportPayload(payload);
    if (importPayload.paths.length === 0 && importPayload.records.length === 0) {
      return [defaultWorkspaceDropChoice(payload, source)];
    }
    return withOpenSeparatelyChoices(payload, [
      choice("import-ketcher-structures", "Add to Ketcher", "default", {
        kind: "import-ketcher-structures",
        payload: importPayload,
      }, source),
    ], source);
  }
  if (target.kind === "fep-setup") {
    return withOpenSeparately(payload, {
      kind: "prepare-fep-setup",
      request: {
        ...target.request,
        candidatePayload: semanticPayload(payload),
      },
    }, "Open FEP setup", source);
  }

  if (target.renderer === "grid2d" && target.documentId && gridAppendPayload(payload)) {
    return withOpenSeparately(payload, {
      kind: "append-grid-records",
      targetDocumentId: target.documentId,
      payload,
    }, "Append to grid", source);
  }

  if (target.renderer === "grid2d" && payload.paths.some(isMoleculeCollectionPath)) {
    return withOpenSeparately(payload, {
      kind: "merge-collection",
      targetPath: target.documentPath,
      paths: payload.paths,
    }, "Merge molecule collections", source);
  }

  if (target.renderer === "xyzrender-external" && (payload.paths.length > 0 || payload.records.length > 0)) {
    return [choice("add-xyzrender-sheet-items", "Add to xyzrender sheet", "default", {
      kind: "add-xyzrender-sheet-items",
      targetDocumentId: target.documentId,
      payload,
    }, source)];
  }

  const dockingChoices = dockingActionChoices(target.documentPath, payload, target.dockingRequest);
  if (dockingChoices.length > 0) {
    return withOpenSeparatelyChoices(payload, tagChoicesWithSource(dockingChoices, source), source);
  }

  return [defaultWorkspaceDropChoice(payload, source)];
}

function gridAppendPayload(payload: StructureDragPayload) {
  return payload.paths.some(isMoleculeCollectionPath)
    || payload.records.some((record) => isMoleculeCollectionPath(record.path));
}

function workspaceDropAction(payload: StructureDragPayload): DropAction {
  if (payload.records.length > 0) {
    return {
      kind: "open-structure-records",
      paths: payload.paths,
      records: payload.records,
    };
  }
  if (payload.paths.length > 0) {
    return {
      kind: "open-documents",
      paths: payload.paths,
    };
  }
  return { kind: "show-inline-record-target-hint" };
}

function semanticPayload(payload: StructureDragPayload): StructureDragPayload {
  return {
    paths: payload.paths,
    records: payload.records,
  };
}

function ketcherImportPayload(payload: StructureDragPayload): StructureDragPayload {
  return {
    paths: payload.paths.filter(isKetcherImportPath),
    records: payload.records.filter((record) => isKetcherImportExtension(record.inputExtension || record.path)),
  };
}

function isKetcherImportPath(path: string) {
  return isKetcherImportExtension(fileExtension(path));
}

function isKetcherImportExtension(extension: string) {
  return ["mol", "sd", "sdf", "smi", "smiles"].includes(extension.trim().replace(/^\./u, "").toLowerCase());
}

function fileExtension(path: string) {
  const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function withOpenSeparately(
  payload: StructureDragPayload,
  defaultAction: DropAction,
  label: string,
  source: DropSourceContext,
): DropActionChoice[] {
  return withOpenSeparatelyChoices(payload, [choice(defaultAction.kind, label, "default", defaultAction, source)], source);
}

function withOpenSeparatelyChoices(
  payload: StructureDragPayload,
  choices: DropActionChoice[],
  source: DropSourceContext,
): DropActionChoice[] {
  const openSeparately = workspaceDropAction(payload);
  if (openSeparately.kind === "open-documents" || openSeparately.kind === "open-structure-records") {
    choices.push(choice(openSeparately.kind, "Open separately", "alternative", openSeparately, source));
  }
  const textPaths = uniquePaths(payload.paths);
  if (textPaths.length > 0) {
    choices.push(choice("open-text-files", "Open as text file", "alternative", {
      kind: "open-text-files",
      paths: textPaths,
    }, source));
  }
  return choices;
}

function dockingActionChoices(
  targetPath: string,
  payload: StructureDragPayload,
  existingDockingRequest?: DockingDocumentRequest | null,
): DropActionChoice[] {
  if (payload.records.length > 0) {
    return dockingRecordActionChoices(targetPath, payload, existingDockingRequest);
  }
  const candidates = dockingCandidatesForDrop(targetPath, payload.paths, existingDockingRequest);
  return candidates.map((request, index) => choice(
    candidates.length === 1 ? "open-docking" : `open-docking-${index}`,
    candidates.length === 1 ? "Open docking view" : `Dock with ${fileName(request.receptorPath)}`,
    index === 0 ? "default" : "alternative",
    {
      kind: "open-docking",
      request,
    },
  ));
}

function dockingRecordActionChoices(
  targetPath: string,
  payload: StructureDragPayload,
  existingDockingRequest?: DockingDocumentRequest | null,
): DropActionChoice[] {
  const candidates = dockingRecordCandidates(targetPath, payload.paths, payload.records, existingDockingRequest);
  return candidates.map((candidate, index) => choice(
    candidates.length === 1 ? "open-docking-with-records" : `open-docking-with-records-${index}`,
    candidates.length === 1 ? "Open docking view" : `Dock with ${fileName(candidate.receptorPath)}`,
    index === 0 ? "default" : "alternative",
    {
      kind: "open-docking-with-records",
      receptorPath: candidate.receptorPath,
      ligandPaths: candidate.ligandPaths,
      records: candidate.records,
    },
  ));
}

function dockingRecordCandidates(
  targetPath: string,
  paths: string[],
  records: StructureDragRecord[],
  existingDockingRequest?: DockingDocumentRequest | null,
) {
  const cleanRecords = records.filter((record) => record.text.trim().length > 0);
  if (cleanRecords.length === 0) return [];
  if (existingDockingRequest) {
    return [{
      receptorPath: existingDockingRequest.receptorPath,
      ligandPaths: uniqueLigandPaths([...existingDockingRequest.ligandPaths, ...paths], existingDockingRequest.receptorPath),
      records: cleanRecords,
    }];
  }
  const allPaths = uniquePaths([targetPath, ...paths]);
  const receptorPaths = allPaths.filter(isProteinLikeDockingSource);
  const combinePaths = allPaths.filter(isMolstarCombineSource);
  const modelOrTopologyPaths = combinePaths.filter((path) => !isMolstarCoordinateTrajectorySource(path));
  const anchorPaths = receptorPaths.length > 0
    ? receptorPaths
    : (modelOrTopologyPaths.length > 0 ? modelOrTopologyPaths : combinePaths);
  return anchorPaths
    .map((receptorPath) => ({
      receptorPath,
      ligandPaths: uniqueLigandPaths(allPaths, receptorPath),
      records: cleanRecords,
    }));
}

function uniqueLigandPaths(paths: string[], receptorPath: string) {
  return uniquePaths(paths).filter((path) => path !== receptorPath && isMolstarCombineSource(path));
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
}

function workspaceDropActionChoices(payload: StructureDragPayload, source: DropSourceContext): DropActionChoice[] {
  const defaultChoice = defaultWorkspaceDropChoice(payload, source);
  if (defaultChoice.action.kind !== "open-documents" || defaultChoice.action.paths.length < 2) {
    return [defaultChoice];
  }
  return [
    choice("open-documents-combined-poses", "Open in One Window", "default", {
      kind: "open-documents-combined-poses",
      paths: defaultChoice.action.paths,
    }, source),
    choice("open-documents-combined-grid", "Open as Grid", "alternative", {
      kind: "open-documents-combined-grid",
      paths: defaultChoice.action.paths,
    }, source),
    choice(defaultChoice.action.kind, "Open as document tabs", "alternative", defaultChoice.action, source),
  ];
}

function defaultWorkspaceDropChoice(payload: StructureDragPayload, source: DropSourceContext): DropActionChoice {
  const action = workspaceDropAction(payload);
  return choice(
    action.kind,
    action.kind === "open-documents" || action.kind === "open-structure-records"
      ? "Open as document tabs"
      : "Choose a molecular target",
    "default",
    action,
    source,
  );
}

function choice(
  id: string,
  label: string,
  confidence: DropActionChoice["confidence"],
  action: DropAction,
  source: DropSourceContext = UNKNOWN_DROP_SOURCE,
): DropActionChoice {
  const result: DropActionChoice = {
    id,
    label,
    confidence,
    action,
  };
  if (source.kind !== "unknown") result.source = source;
  return result;
}

function tagChoicesWithSource(choices: DropActionChoice[], source: DropSourceContext) {
  if (source.kind === "unknown") return choices;
  return choices.map((candidate) => ({
    ...candidate,
    source,
  }));
}

function fileName(path: string) {
  return path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
}
