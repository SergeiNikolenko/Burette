import { invoke } from "@tauri-apps/api/core";
import type { ViewerDocument } from "../types";
import { isTauriRuntime } from "./tauri";

export type DescriptorPayloadFormat = "molfile" | "sdf" | "smiles";
export type DescriptorSourceKind = "document" | "ketcher";

export type DescriptorSourcePayload = {
  sourceKind: DescriptorSourceKind;
  sourceLabel: string;
  format: DescriptorPayloadFormat;
  text: string;
};

export type DescriptorRuntimeStatus = {
  available: boolean;
  pythonPath?: string | null;
  mordredVersion?: string | null;
  rdkitVersion?: string | null;
  message: string;
  installHint: string;
};

export type DescriptorRuntimeInstallResult = {
  pythonPath: string;
  message: string;
};

export type DescriptorCellValue = {
  id: string;
  label: string;
  value?: number | string | boolean | null;
  missingKind?: string | null;
  errorText?: string | null;
};

export type DescriptorDefinition = {
  id: string;
  label: string;
  module: string;
  description: string;
  units?: string;
};

export const BASIC_DESCRIPTOR_DEFINITIONS: Record<string, DescriptorDefinition> = {
  MW: {
    id: "MW",
    label: "Molecular weight",
    module: "Constitutional",
    description: "Molecular weight calculated from the atoms in the parsed molecule.",
    units: "Da",
  },
  AMW: {
    id: "AMW",
    label: "Average molecular weight",
    module: "Constitutional",
    description: "Average atomic weight for the molecule.",
    units: "Da per atom",
  },
  nAtom: {
    id: "nAtom",
    label: "Atoms",
    module: "Constitutional",
    description: "Total number of atoms in the parsed molecular graph.",
  },
  nHeavyAtom: {
    id: "nHeavyAtom",
    label: "Heavy atoms",
    module: "Constitutional",
    description: "Number of non-hydrogen atoms.",
  },
  nHetero: {
    id: "nHetero",
    label: "Hetero atoms",
    module: "Constitutional",
    description: "Number of atoms that are neither carbon nor hydrogen.",
  },
  nBonds: {
    id: "nBonds",
    label: "Bonds",
    module: "Constitutional",
    description: "Total number of bonds in the parsed molecular graph.",
  },
  nBondsO: {
    id: "nBondsO",
    label: "Order-sensitive bonds",
    module: "Constitutional",
    description: "Mordred bond-count descriptor that accounts for bond order.",
  },
  nBondsS: {
    id: "nBondsS",
    label: "Single bonds",
    module: "Constitutional",
    description: "Number of single bonds.",
  },
  nRot: {
    id: "nRot",
    label: "Rotatable bonds",
    module: "Constitutional",
    description: "Number of rotatable bonds according to Mordred/RDKit perception.",
  },
  nRing: {
    id: "nRing",
    label: "Rings",
    module: "Ring",
    description: "Number of rings perceived in the molecular graph.",
  },
  nAromAtom: {
    id: "nAromAtom",
    label: "Aromatic atoms",
    module: "Aromatic",
    description: "Number of atoms marked aromatic after molecule sanitization.",
  },
  nAromBond: {
    id: "nAromBond",
    label: "Aromatic bonds",
    module: "Aromatic",
    description: "Number of bonds marked aromatic after molecule sanitization.",
  },
  TopoPSA: {
    id: "TopoPSA",
    label: "Topological polar surface area",
    module: "Topological",
    description: "Topological estimate of polar surface area from polar fragments.",
    units: "A^2",
  },
  SLogP: {
    id: "SLogP",
    label: "SLogP",
    module: "Crippen",
    description: "Wildman-Crippen style estimate of octanol/water partition coefficient.",
  },
};

export function descriptorDefinition(id: string, fallbackLabel?: string): DescriptorDefinition {
  const known = BASIC_DESCRIPTOR_DEFINITIONS[id];
  if (known) return known;
  return {
    id,
    label: fallbackLabel || id,
    module: "Mordred",
    description: "Mordred descriptor calculated from the parsed molecule.",
  };
}

export type DescriptorCalculationResult = {
  ok: boolean;
  descriptorSet: string;
  molecule?: {
    atomCount: number;
    bondCount: number;
  };
  engine?: {
    mordredVersion?: string | null;
    rdkitVersion?: string | null;
  };
  values: DescriptorCellValue[];
};

export type GridDescriptorRunSummary = {
  totalRows: number;
  calculatedRows: number;
  failedRows: number;
  descriptorIdCount: number;
  descriptorIds: string[];
};

export type GridDescriptorJobStatus = {
  documentId: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  running: boolean;
  totalRows: number;
  processedRows: number;
  calculatedRows: number;
  failedRows: number;
  message: string;
  startedAtMs: number;
  finishedAtMs?: number | null;
  summary?: GridDescriptorRunSummary | null;
  rows?: GridDescriptorResultRow[];
};

export type GridDescriptorResultRow = {
  index: number;
  rowId?: string | number | null;
  descriptors: Record<string, DescriptorCellValue>;
};

export type GridDescriptorRunOptions = {
  rowIndexes?: number[];
};

export type GridDescriptorFilter = {
  id: string;
  min?: number;
  max?: number;
};

export type GridDescriptorSort = {
  id: string;
  direction: "asc" | "desc";
};

export type GridDescriptorControls = {
  filters: GridDescriptorFilter[];
  descriptorSort: GridDescriptorSort | null;
};

export async function descriptorRuntimeStatus(): Promise<DescriptorRuntimeStatus> {
  if (!isTauriRuntime()) {
    return fetchBrowserDevJson<DescriptorRuntimeStatus>("/__burette/descriptors/status");
  }
  return invoke<DescriptorRuntimeStatus>("descriptor_runtime_status");
}

export async function installDescriptorRuntime(): Promise<DescriptorRuntimeInstallResult> {
  if (!isTauriRuntime()) {
    return fetchBrowserDevJson<DescriptorRuntimeInstallResult>("/__burette/descriptors/install", {});
  }
  return invoke<DescriptorRuntimeInstallResult>("descriptor_runtime_install");
}

export async function calculateDescriptors(source: DescriptorSourcePayload): Promise<DescriptorCalculationResult> {
  if (!isTauriRuntime()) {
    return fetchBrowserDevJson<DescriptorCalculationResult>("/__burette/descriptors/calculate", {
      source,
      descriptorSet: "all-2d",
    });
  }
  return invoke<DescriptorCalculationResult>("descriptor_calculate", {
    request: {
      sourceKind: source.sourceKind,
      sourceLabel: source.sourceLabel,
      descriptorSet: "all-2d",
      sourcePayload: {
        format: source.format,
        text: source.text,
        label: source.sourceLabel,
      },
    },
  });
}

export async function calculateGridDescriptors(
  documentId: string,
  sourcePath?: string | null,
  options: GridDescriptorRunOptions = {},
): Promise<GridDescriptorJobStatus> {
  const rowIndexes = normalizeRowIndexes(options.rowIndexes);
  if (!isTauriRuntime()) {
    if (!sourcePath) throw new Error("Browser-dev descriptor calculation needs the source file path.");
    return fetchBrowserDevJson<GridDescriptorJobStatus>("/__burette/descriptors/grid", {
      documentId,
      path: sourcePath,
      descriptorSet: "all-2d",
      ...(rowIndexes.length ? { rowIndexes } : {}),
    });
  }
  return invoke<GridDescriptorJobStatus>("descriptor_start_grid", {
    request: { documentId, ...(rowIndexes.length ? { rowIndexes } : {}) },
  });
}

export async function gridDescriptorJobStatus(documentId: string): Promise<GridDescriptorJobStatus> {
  if (!isTauriRuntime()) {
    const response = await fetch(`/__burette/descriptors/grid-job-status?documentId=${encodeURIComponent(documentId)}`);
    if (!response.ok) throw new Error(await response.text());
    return await response.json() as GridDescriptorJobStatus;
  }
  return invoke<GridDescriptorJobStatus>("descriptor_grid_job_status", { documentId });
}

export async function cancelGridDescriptorJob(documentId: string): Promise<GridDescriptorJobStatus> {
  if (!isTauriRuntime()) {
    return fetchBrowserDevJson<GridDescriptorJobStatus>("/__burette/descriptors/grid-cancel", {
      documentId,
    });
  }
  return invoke<GridDescriptorJobStatus>("descriptor_cancel_grid", {
    request: { documentId },
  });
}

export async function gridDescriptorSummary(documentId: string, sourcePath?: string | null): Promise<GridDescriptorRunSummary> {
  if (!isTauriRuntime()) {
    if (!sourcePath) {
      return {
        totalRows: 0,
        calculatedRows: 0,
        failedRows: 0,
        descriptorIdCount: 0,
        descriptorIds: [],
      };
    }
    return fetchBrowserDevJson<GridDescriptorRunSummary>("/__burette/descriptors/grid-summary", {
      documentId,
      path: sourcePath,
    });
  }
  return invoke<GridDescriptorRunSummary>("descriptor_grid_summary", { documentId });
}

async function fetchBrowserDevJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `Browser-dev descriptor request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function normalizeRowIndexes(indexes: number[] | undefined) {
  if (!Array.isArray(indexes)) return [];
  return Array.from(new Set(indexes
    .map((index) => Math.trunc(Number(index)))
    .filter((index) => Number.isFinite(index) && index >= 0)))
    .sort((left, right) => left - right);
}

export function descriptorSourceFromDocument(document: ViewerDocument, text: string): DescriptorSourcePayload | { reason: string } {
  const extension = document.extension.toLowerCase();
  if (extension === "mol") {
    return {
      sourceKind: "document",
      sourceLabel: document.title,
      format: "molfile",
      text,
    };
  }
  if (extension === "sdf" || extension === "sd") {
    const recordCount = sdfRecordCount(text);
    if (recordCount > 1) {
      return { reason: "Open this SDF as a grid collection to calculate descriptors for all rows." };
    }
    return {
      sourceKind: "document",
      sourceLabel: document.title,
      format: "sdf",
      text,
    };
  }
  if (extension === "smi" || extension === "smiles") {
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 1) {
      return { reason: "Open this SMILES file as a grid collection to calculate descriptors for all rows." };
    }
    if (lines.length === 0) return { reason: "SMILES file is empty." };
    return {
      sourceKind: "document",
      sourceLabel: document.title,
      format: "smiles",
      text: lines[0],
    };
  }
  return { reason: "Descriptors are available for small-molecule MOL, single-record SDF, and one-row SMILES sources." };
}

function sdfRecordCount(text: string) {
  const markers = text.match(/^\$\$\$\$\s*$/gmu);
  if (markers) return markers.length;
  return text.trim() ? 1 : 0;
}
