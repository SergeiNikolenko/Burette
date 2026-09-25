// Bounded, read-only grid state reported by grid-viewer.js (`gridAgentState`)
// and surfaced as the `grid` block of the agent observe payload.

const MAX_TRACKED_DOCUMENTS = 64;
const MAX_SELECTED_IDS = 50;
const MAX_FILTERS = 20;
const MAX_TEXT = 256;

export type AgentGridFilter = {
  id: string;
  type: "number" | "text";
  min?: number;
  max?: number;
  text?: string;
};

export type AgentGridState = {
  sort: { key: string; direction: "asc" | "desc" };
  searchQuery: string;
  searchQueryTruncated: boolean;
  smartsSearch: boolean;
  filters: AgentGridFilter[];
  filterCount: number;
  chemicalSpaceFilterActive: boolean;
  selectedCount: number;
  selectedRowIds: number[];
  selectionTruncated: boolean;
  totalRows: number;
  visibleRows: number;
  viewMode: string;
  indexing: boolean;
  updatedAt: string;
};

const gridStates = new Map<string, AgentGridState>();

function boundedText(value: unknown) {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : "";
}

function count(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function sanitizeFilter(value: unknown): AgentGridFilter | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = boundedText(raw.id);
  if (!id) return null;
  if (raw.type === "number") {
    const filter: AgentGridFilter = { id, type: "number" };
    if (typeof raw.min === "number" && Number.isFinite(raw.min)) filter.min = raw.min;
    if (typeof raw.max === "number" && Number.isFinite(raw.max)) filter.max = raw.max;
    return filter;
  }
  return { id, type: "text", text: boundedText(raw.text) };
}

export function sanitizeAgentGridState(value: unknown, now = new Date()): AgentGridState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const sort = raw.sort && typeof raw.sort === "object" ? raw.sort as Record<string, unknown> : {};
  const filters = Array.isArray(raw.filters)
    ? raw.filters.slice(0, MAX_FILTERS).map(sanitizeFilter).filter((filter): filter is AgentGridFilter => filter !== null)
    : [];
  const rawIds = Array.isArray(raw.selectedRowIds) ? raw.selectedRowIds : [];
  const selectedRowIds = rawIds
    .filter((id): id is number => Number.isSafeInteger(id) && (id as number) >= 0)
    .slice(0, MAX_SELECTED_IDS);
  const selectedCount = Math.max(count(raw.selectedCount), selectedRowIds.length);
  return {
    sort: {
      key: boundedText(sort.key) || "index",
      direction: sort.direction === "desc" ? "desc" : "asc",
    },
    searchQuery: boundedText(raw.searchQuery),
    searchQueryTruncated: raw.searchQueryTruncated === true || (typeof raw.searchQuery === "string" && raw.searchQuery.length > MAX_TEXT),
    smartsSearch: raw.smartsSearch === true,
    filters,
    filterCount: Math.max(count(raw.filterCount), filters.length),
    chemicalSpaceFilterActive: raw.chemicalSpaceFilterActive === true,
    selectedCount,
    selectedRowIds,
    selectionTruncated: selectedCount > selectedRowIds.length,
    totalRows: count(raw.totalRows),
    visibleRows: count(raw.visibleRows),
    viewMode: boundedText(raw.viewMode),
    indexing: raw.indexing === true,
    updatedAt: now.toISOString(),
  };
}

/** Records a `gridAgentState` message body; returns false when it is not usable. */
export function recordAgentGridState(body: { documentId?: unknown; gridState?: unknown }) {
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  const next = documentId ? sanitizeAgentGridState(body.gridState) : null;
  if (!next) return false;
  gridStates.delete(documentId);
  gridStates.set(documentId, next);
  while (gridStates.size > MAX_TRACKED_DOCUMENTS) {
    const oldest = gridStates.keys().next().value;
    if (oldest === undefined) break;
    gridStates.delete(oldest);
  }
  return true;
}

export function agentGridState(documentId: string | null | undefined) {
  return documentId ? gridStates.get(documentId) ?? null : null;
}
