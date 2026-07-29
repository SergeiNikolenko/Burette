export const MESOSCALE_API_VERSION = "burette-mesoscale/v2" as const;
export const MESOSCALE_HIERARCHY_PAGE_LIMIT = 128;

export type MesoscaleGraphicsMode = "ultra" | "quality" | "balanced" | "performance" | "custom";
export type MesoscaleLayoutRegion = "left" | "right";
export type MesoscaleMotion = "off" | "spin" | "rock";

export type MesoscaleCounts = {
  roots: number;
  groups: number;
  entities: number;
  instances: number;
  elements: number;
  meshes: number;
  snapshots: number;
};

export type MesoscaleSnapshot = {
  id: string;
  name: string;
  description: string;
  current: boolean;
};

export type MesoscaleLoadReport = {
  schemaVersion: number;
  kind: string;
  sourceExtension: string;
  sourceBytes: number;
  sourceSha256: string;
  package: Record<string, unknown> | null;
  counts: MesoscaleCounts;
  loadMs: number;
  warnings: string[];
};

export type MesoscaleSceneSummary = {
  kind: "summary";
  revision: number;
  graphics: MesoscaleGraphicsMode | null;
  filter: string;
  counts: MesoscaleCounts;
  selectedRefs: string[];
  selectionMode: boolean;
  illumination: boolean;
  layout: Record<MesoscaleLayoutRegion, boolean>;
  motion: MesoscaleMotion;
  snapshots: MesoscaleSnapshot[];
  hierarchyPreview: MesoscaleHierarchyObject[];
  hierarchyTotal: number;
  loadReport: MesoscaleLoadReport | null;
};

export type MesoscaleHierarchyObject = {
  ref: string;
  parentRef: string | null;
  kind: "group" | "structure" | "mesh";
  label: string;
  description: string;
  hidden: boolean;
  selected: boolean;
  elementCount: number;
  instanceCount: number;
};

export type MesoscaleHierarchyPage = {
  kind: "hierarchy-page";
  revision: number;
  filter: string;
  cursor: number;
  nextCursor: number | null;
  total: number;
  items: MesoscaleHierarchyObject[];
};

export type MesoscaleExportResult = {
  kind: "export";
  revision: number;
  type: "png" | "molx" | "molj";
  bytes?: number;
  requested?: boolean;
};

export type MesoscaleCapabilities = {
  kind: "capabilities";
  apiVersion: typeof MESOSCALE_API_VERSION;
  actions: MesoscaleAction["type"][];
  graphicsModes: MesoscaleGraphicsMode[];
  hierarchyPageLimit: number;
};

export type MesoscaleAction =
  | { type: "getSummary" }
  | { type: "getHierarchyPage"; filter?: string; cursor?: number; limit?: number }
  | { type: "setGraphics"; graphics: MesoscaleGraphicsMode }
  | { type: "setFilter"; filter: string }
  | { type: "setSelection"; ref?: string; mode?: "replace" | "extend" | "toggle" | "clear" }
  | { type: "setSelectionMode"; enabled: boolean }
  | { type: "setIllumination"; enabled: boolean }
  | { type: "setLayoutRegion"; region: MesoscaleLayoutRegion; visible: boolean }
  | { type: "setMotion"; motion: MesoscaleMotion }
  | { type: "focusObject"; ref: string }
  | { type: "setVisibility"; ref: string; visible: boolean }
  | { type: "isolateObjects"; refs: string[] }
  | { type: "setStyle"; ref: string; color?: number; opacity?: number; emissive?: number; clipObjects?: unknown[] }
  | { type: "resetCamera" }
  | { type: "createSnapshot"; name: string; description?: string }
  | { type: "applySnapshot"; id: string }
  | { type: "deleteSnapshot"; id: string }
  | { type: "exportState"; format?: "molx" | "molj" }
  | { type: "exportPng" }
  | { type: "getCapabilities" };

export type MesoscaleRequest = {
  source: "burette-mesoscale-host";
  apiVersion: typeof MESOSCALE_API_VERSION;
  documentId: string;
  requestId: string;
  expectedRevision?: number;
  action: MesoscaleAction;
};

// Hover is intentionally a separate, response-free channel. It is transient
// viewport state and must never increment the scene revision, enter history, or
// make the Scene panel look busy while the pointer moves across many rows.
export type MesoscalePreviewMessage = {
  source: "burette-mesoscale-preview";
  apiVersion: typeof MESOSCALE_API_VERSION;
  documentId: string;
  sequence: number;
  ref: string | null;
};

export type MesoscaleFailure = {
  kind: "failure";
  code: string;
  message: string;
  revision: number;
};

export type MesoscaleResult =
  | MesoscaleSceneSummary
  | MesoscaleHierarchyPage
  | MesoscaleExportResult
  | MesoscaleCapabilities
  | MesoscaleFailure;

export type MesoscaleResponse = {
  source: "burette-mesoscale-runtime";
  apiVersion: typeof MESOSCALE_API_VERSION;
  documentId: string;
  requestId?: string;
  result: MesoscaleResult;
};

export type MesoscaleSessionState = {
  status: "loading" | "ready" | "busy" | "error" | "disposed";
  documentId: string;
  revision: number;
  summary: MesoscaleSceneSummary | null;
  hierarchy: MesoscaleHierarchyObject[];
  hierarchyFilter: string;
  hierarchyNextCursor: number | null;
  hierarchyTotal: number;
  hoveredRef: string | null;
  sceneOpen: boolean;
  layoutPreference: Record<MesoscaleLayoutRegion, boolean>;
  pendingCount: number;
  error: MesoscaleFailure | null;
};

export function isMesoscaleResponse(value: unknown): value is MesoscaleResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<MesoscaleResponse>;
  return response.source === "burette-mesoscale-runtime"
    && response.apiVersion === MESOSCALE_API_VERSION
    && typeof response.documentId === "string"
    && Boolean(response.result && typeof response.result === "object");
}
