export const HOSTED_MCP_WIDGET_QUERY = "mcpWidget";
export const HOSTED_MCP_WIDGET_MESSAGE_SOURCE = "burrete-hosted-mcp-widget";

const MAX_HOSTED_STRUCTURE_BYTES = 3 * 1024 * 1024;
const MAX_HOSTED_LABEL_LENGTH = 255;
const MAX_HOSTED_SELECTION_RESIDUES = 96;
const HOSTED_STRUCTURE_FORMATS = new Set(["pdb", "mmcif", "sdf", "xyz"]);
let hostedSelectionRequestId = 0;

type UnknownRecord = Record<string, unknown>;

export type HostedMcpStructure = {
  data: string;
  format: string;
  label: string;
};

type HostedMcpSelectionResidue = {
  chain: string;
  compId: string;
  sequence: number | string | null;
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? value as UnknownRecord : null;
}

function normalizedFormat(value: unknown) {
  const format = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (format === "cif" || format === "mcif") return "mmcif";
  if (format === "sd") return "sdf";
  return HOSTED_STRUCTURE_FORMATS.has(format) ? format : null;
}

function metadataFromResult(result: UnknownRecord) {
  const metadata = record(result._meta) ?? record(result.meta);
  if (!metadata) return null;
  return record(metadata._meta)
    ?? nestedResultMetadata(metadata.mcp_tool_result)
    ?? nestedResultMetadata(metadata.call_tool_result)
    ?? metadata;
}

function nestedResultMetadata(value: unknown) {
  const envelope = record(value);
  const result = record(envelope?.result);
  return record(result?._meta) ?? record(envelope?._meta);
}

function boundedLabel(value: unknown, fallback: string) {
  const label = typeof value === "string" ? value.trim() : "";
  return (label || fallback).slice(0, MAX_HOSTED_LABEL_LENGTH);
}

function selectionResidue(value: unknown): HostedMcpSelectionResidue | null {
  const residue = record(value);
  if (!residue) return null;
  const sequence = typeof residue.sequence === "number" || typeof residue.sequence === "string"
    ? residue.sequence
    : null;
  return {
    chain: boundedLabel(residue.chain, ""),
    compId: boundedLabel(residue.compId, ""),
    sequence,
  };
}

export function createHostedMcpSelectionContext(value: unknown, documentId: string) {
  const selection = record(value);
  if (!selection || selection.source !== "lasso") return null;
  const residues = Array.isArray(selection.residues)
    ? selection.residues
      .slice(0, MAX_HOSTED_SELECTION_RESIDUES)
      .map(selectionResidue)
      .filter((residue): residue is HostedMcpSelectionResidue => residue !== null)
    : [];
  const atoms = Math.max(0, Math.trunc(Number(selection.atoms) || 0));
  const label = boundedLabel(
    selection.label,
    `Lasso selection with ${atoms} visible atoms across ${residues.length} residues`,
  );
  const activeSelection = {
    source: "lasso",
    documentId: boundedLabel(documentId, "active-structure"),
    label,
    atoms,
    residues,
  };
  return {
    content: [{
      type: "text" as const,
      text: `Current Burrete selection: ${label}. Treat this as the user's active molecular selection for their next request.`,
    }],
    structuredContent: { burrete: { activeSelection } },
  };
}

export function updateHostedMcpSelectionContext(value: unknown, documentId: string) {
  if (!isHostedMcpWidget() || !window.parent) return false;
  const params = createHostedMcpSelectionContext(value, documentId);
  if (!params) return false;
  hostedSelectionRequestId += 1;
  window.parent.postMessage({
    jsonrpc: "2.0",
    id: `burrete-selection-context-${hostedSelectionRequestId}`,
    method: "ui/update-model-context",
    params,
  }, "*");
  return true;
}

export function isHostedMcpWidgetLocation(location: Pick<Location, "search">) {
  return new URLSearchParams(location.search).get(HOSTED_MCP_WIDGET_QUERY) === "1";
}

export function isHostedMcpWidget() {
  return typeof window !== "undefined" && (
    window.__BURRETE_HOSTED_MCP_WIDGET__ === true
    || isHostedMcpWidgetLocation(window.location)
  );
}

export function parseHostedMcpStructureResult(value: unknown): HostedMcpStructure | null {
  const result = record(value);
  if (!result) return null;
  const metadata = metadataFromResult(result);
  const structure = record(metadata?.structure);
  const data = typeof structure?.data === "string" ? structure.data : "";
  const byteCount = new TextEncoder().encode(data).length;
  const format = normalizedFormat(structure?.format);
  if (!data || byteCount > MAX_HOSTED_STRUCTURE_BYTES || !format) return null;

  const structuredContent = record(result.structuredContent);
  const label = boundedLabel(
    structure?.label,
    boundedLabel(structuredContent?.fileName, "Molecular structure"),
  );
  return {
    data,
    format,
    label,
  };
}

export function parseHostedMcpStructureMessage(value: unknown): HostedMcpStructure | null {
  const message = record(value);
  if (!message) return null;
  if (
    message.source === HOSTED_MCP_WIDGET_MESSAGE_SOURCE
    && message.type === "tool-result"
  ) return parseHostedMcpStructureResult(message.result);
  if (
    message.jsonrpc === "2.0"
    && message.method === "ui/notifications/tool-result"
  ) return parseHostedMcpStructureResult(message.params);
  return null;
}

export function isHostedMcpToolResultMessage(value: unknown): boolean {
  const message = record(value);
  if (!message) return false;
  return (
    message.source === HOSTED_MCP_WIDGET_MESSAGE_SOURCE
    && message.type === "tool-result"
  ) || (
    message.jsonrpc === "2.0"
    && message.method === "ui/notifications/tool-result"
  );
}

export function selectHostedMcpInitialStructure(
  queuedResults: readonly unknown[],
  openAiResult?: unknown,
): HostedMcpStructure | null {
  if (queuedResults.length > 0) {
    return parseHostedMcpStructureResult(queuedResults[queuedResults.length - 1]);
  }
  return parseHostedMcpStructureResult(openAiResult);
}
