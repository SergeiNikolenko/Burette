export const MESOSCALE_API_VERSION = "burette-mesoscale/v2" as const;
export const MESOSCALE_HIERARCHY_PAGE_LIMIT = 128;
export const MESOSCALE_HIERARCHY_DETAIL_LIMIT = 512;
export const MESOSCALE_HIERARCHY_DETAIL_PER_OBJECT_LIMIT = 64;
export const MESOSCALE_HIERARCHY_DETAIL_DEPTH_LIMIT = 4;
export const MESOSCALE_HIERARCHY_TEXT_LIMIT = 256;
export const MESOSCALE_HIERARCHY_INSPECTION_LIMIT = 1024;
export const MESOSCALE_SELECTION_BATCH_LIMIT = 4096;
export const MESOSCALE_SELECTION_REF_LIMIT = 256;

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
  selectedDetails?: MesoscaleSelectedDetail[];
  selectedCount?: number;
  selectionTruncated?: boolean;
  selectionVersion?: number;
  selectionMode: boolean;
  illumination: boolean;
  hoverDimming?: boolean;
  layout: Record<MesoscaleLayoutRegion, boolean>;
  motion: MesoscaleMotion;
  snapshots: MesoscaleSnapshot[];
  hierarchyPreview: MesoscaleHierarchyObject[];
  hierarchyTotal: number;
  loadReport: MesoscaleLoadReport | null;
};

export type MesoscaleHierarchySelector = {
  model: string;
  chain: string;
  operator: string;
};

export type MesoscaleSelectedDetail = {
  ref: string;
  id: string;
};

export type MesoscaleHierarchyDetail = {
  id: string;
  label: string;
  detail: string;
  selector?: MesoscaleHierarchySelector;
  childCount?: number;
  childrenTruncated?: boolean;
  children?: MesoscaleHierarchyDetail[];
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
  color: number | null;
  opacity: number | null;
  emissive: number | null;
  childCount?: number;
  childrenTruncated?: boolean;
  children?: MesoscaleHierarchyDetail[];
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
  | { type: "setSelectionBatch"; refs: string[]; mode?: "replace" | "extend" }
  | { type: "setDetailSelection"; ref: string; selector: MesoscaleHierarchySelector; mode?: "replace" | "extend" | "toggle" }
  | { type: "setDetailSelectionBatch"; ref: string; selectors: MesoscaleHierarchySelector[]; mode?: "replace" | "extend" }
  | { type: "setHoverDimming"; enabled: boolean }
  | { type: "setSelectionStyle"; color?: number; opacity?: number; emissive?: number; selectionVersion?: number }
  | { type: "setSelectionVisibility"; visible: boolean }
  | { type: "isolateSelection" }
  | { type: "setSelectionMode"; enabled: boolean }
  | { type: "setIllumination"; enabled: boolean }
  | { type: "setLayoutRegion"; region: MesoscaleLayoutRegion; visible: boolean }
  | { type: "setMotion"; motion: MesoscaleMotion }
  | { type: "focusObject"; ref: string }
  | { type: "focusDetail"; ref: string; selector: MesoscaleHierarchySelector }
  | { type: "setVisibility"; ref: string; visible: boolean }
  | { type: "isolateObjects"; refs: string[] }
  | { type: "setStyle"; ref: string; color?: number; opacity?: number; emissive?: number; clipObjects?: unknown[] }
  | { type: "resetCamera" }
  | { type: "orientAxes" }
  | { type: "resetAxes" }
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
  selector?: MesoscaleHierarchySelector;
};

export type MesoscaleControlPlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
};

// Burette positions Mol*'s native viewport rail beside the draggable host
// toolbar. This is transient chrome state, not part of the scene revision.
export type MesoscaleChromeMessage = {
  source: "burette-mesoscale-chrome";
  apiVersion: typeof MESOSCALE_API_VERSION;
  documentId: string;
  placement: MesoscaleControlPlacement;
};

export type MesoscaleCanvasContextMenu = {
  item: MesoscaleHierarchyObject;
  selectedCount: number;
  x: number;
  y: number;
  token: number;
};

export type MesoscaleCanvasInteractionMessage = {
  source: "burette-mesoscale-interaction";
  apiVersion: typeof MESOSCALE_API_VERSION;
  documentId: string;
} & (
  | { kind: "selection"; summary: MesoscaleSceneSummary }
  | { kind: "context-menu"; menu: Omit<MesoscaleCanvasContextMenu, "token">; summary: MesoscaleSceneSummary }
  | { kind: "layout-resize"; reservation: { left: number; right: number } }
  // Closing a panel by squeezing its divider is a user gesture, so it has to
  // update the host's remembered layout instead of being restored right back.
  | { kind: "layout-collapse"; regions: MesoscaleLayoutRegion[]; summary: MesoscaleSceneSummary }
);

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
  canvasContextMenu: MesoscaleCanvasContextMenu | null;
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

export function isMesoscaleCanvasInteractionMessage(value: unknown): value is MesoscaleCanvasInteractionMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<{
    source: MesoscaleCanvasInteractionMessage["source"];
    apiVersion: MesoscaleCanvasInteractionMessage["apiVersion"];
    documentId: string;
    kind: MesoscaleCanvasInteractionMessage["kind"];
    summary: MesoscaleSceneSummary;
    menu: Omit<MesoscaleCanvasContextMenu, "token">;
    reservation: { left: number; right: number };
  }>;
  if (message.source !== "burette-mesoscale-interaction") return false;
  if (message.apiVersion !== MESOSCALE_API_VERSION || typeof message.documentId !== "string") return false;
  if (message.kind === "layout-resize") {
    const reservation = message.reservation as { left?: unknown; right?: unknown } | undefined;
    return Boolean(reservation)
      && Number.isFinite(reservation?.left) && Number.isFinite(reservation?.right)
      && Number(reservation?.left) >= 0 && Number(reservation?.left) <= 4096
      && Number(reservation?.right) >= 0 && Number(reservation?.right) <= 4096;
  }
  if (!message.summary || message.summary.kind !== "summary") return false;
  if (message.kind === "layout-collapse") {
    const regions = (message as { regions?: unknown }).regions;
    return Array.isArray(regions) && regions.length > 0 && regions.every((region) => region === "left" || region === "right");
  }
  if (message.kind === "selection") return true;
  if (message.kind !== "context-menu" || !message.menu || typeof message.menu !== "object") return false;
  const menu = message.menu as Partial<MesoscaleCanvasContextMenu>;
  return Boolean(menu.item && typeof menu.item.ref === "string")
    && Number.isFinite(menu.selectedCount)
    && Number.isFinite(menu.x)
    && Number.isFinite(menu.y);
}

export function mesoscaleSelectedCount(summary: Pick<MesoscaleSceneSummary, "selectedCount" | "selectedRefs">) {
  return Number.isFinite(summary.selectedCount)
    ? Math.max(0, Math.trunc(summary.selectedCount as number))
    : summary.selectedRefs.length;
}

export function mergeMesoscaleHierarchySelection(items: MesoscaleHierarchyObject[], summary: MesoscaleSceneSummary) {
  const selectedRefs = new Set(summary.selectedRefs);
  const previewByRef = new Map(summary.hierarchyPreview.map((item) => [item.ref, item]));
  const complete = !summary.selectionTruncated && mesoscaleSelectedCount(summary) <= selectedRefs.size;
  return items.map((item) => {
    const preview = previewByRef.get(item.ref);
    return {
      ...item,
      ...preview,
      selected: preview?.selected ?? (selectedRefs.has(item.ref) || (!complete && item.selected)),
    };
  });
}

function boundedMesoscaleText(value: unknown, limit = MESOSCALE_HIERARCHY_TEXT_LIMIT) {
  return String(value ?? "").slice(0, limit);
}

export function boundMesoscaleHierarchyPage(page: MesoscaleHierarchyPage): MesoscaleHierarchyPage {
  const detailBudget = { remaining: MESOSCALE_HIERARCHY_DETAIL_LIMIT };
  const inspectionBudget = { remaining: MESOSCALE_HIERARCHY_INSPECTION_LIMIT };
  const seen = new WeakSet<object>();
  const boundDetails = (values: unknown, depth: number, objectBudget: { remaining: number }): MesoscaleHierarchyDetail[] => {
    if (!Array.isArray(values) || depth > MESOSCALE_HIERARCHY_DETAIL_DEPTH_LIMIT || detailBudget.remaining <= 0 || objectBudget.remaining <= 0) return [];
    const bounded: MesoscaleHierarchyDetail[] = [];
    const inspected = Math.min(values.length, inspectionBudget.remaining);
    for (let index = 0; index < inspected; index += 1) {
      if (detailBudget.remaining <= 0 || objectBudget.remaining <= 0 || inspectionBudget.remaining <= 0) break;
      inspectionBudget.remaining -= 1;
      const value = values[index];
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      const detail = value as Partial<MesoscaleHierarchyDetail>;
      const id = boundedMesoscaleText(detail.id);
      if (!id) continue;
      detailBudget.remaining -= 1;
      objectBudget.remaining -= 1;
      const rawChildren = Array.isArray(detail.children) ? detail.children : [];
      const children = boundDetails(rawChildren, depth + 1, objectBudget);
      const childCount = Math.max(children.length, Number.isFinite(detail.childCount) ? Math.max(0, Math.trunc(detail.childCount as number)) : rawChildren.length);
      const rawSelector = detail.selector;
      const selector = rawSelector && typeof rawSelector === "object"
        ? {
            model: boundedMesoscaleText(rawSelector.model),
            chain: boundedMesoscaleText(rawSelector.chain),
            operator: boundedMesoscaleText(rawSelector.operator),
          }
        : undefined;
      bounded.push({
        id,
        label: boundedMesoscaleText(detail.label),
        detail: boundedMesoscaleText(detail.detail),
        ...(selector?.model && selector.chain && selector.operator ? { selector } : {}),
        childCount,
        childrenTruncated: Boolean(detail.childrenTruncated) || children.length < childCount,
        children,
      });
    }
    return bounded;
  };
  const items = (Array.isArray(page.items) ? page.items : []).slice(0, MESOSCALE_HIERARCHY_PAGE_LIMIT).map((item) => {
    const objectBudget = { remaining: MESOSCALE_HIERARCHY_DETAIL_PER_OBJECT_LIMIT };
    const rawChildren = Array.isArray(item.children) ? item.children : [];
    const children = boundDetails(rawChildren, 1, objectBudget);
    const childCount = Math.max(children.length, Number.isFinite(item.childCount) ? Math.max(0, Math.trunc(item.childCount as number)) : rawChildren.length);
    return {
      ...item,
      ref: boundedMesoscaleText(item.ref, MESOSCALE_SELECTION_REF_LIMIT),
      parentRef: item.parentRef === null ? null : boundedMesoscaleText(item.parentRef, MESOSCALE_SELECTION_REF_LIMIT),
      label: boundedMesoscaleText(item.label),
      description: boundedMesoscaleText(item.description),
      childCount,
      childrenTruncated: Boolean(item.childrenTruncated) || children.length < childCount,
      children,
    };
  });
  return { ...page, items };
}
