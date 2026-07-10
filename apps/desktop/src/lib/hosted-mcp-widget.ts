export const HOSTED_MCP_WIDGET_QUERY = "mcpWidget";
export const HOSTED_MCP_WIDGET_MESSAGE_SOURCE = "burrete-hosted-mcp-widget";

const MAX_HOSTED_STRUCTURE_BYTES = 3 * 1024 * 1024;
const MAX_HOSTED_LABEL_LENGTH = 255;
const HOSTED_STRUCTURE_FORMATS = new Set(["pdb", "mmcif", "sdf", "xyz"]);

type UnknownRecord = Record<string, unknown>;

export type HostedMcpStructure = {
  data: string;
  format: string;
  label: string;
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
