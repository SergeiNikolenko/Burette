import { z } from "zod/v4";
import { ListToolsRequestSchema, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VIEWER_RESOURCE_URI } from "./widget";

export const PUBLIC_OUTPUT_LIMITS = {
  scalarChars: 512,
  fileNameChars: 255,
  rows: 12,
  componentItems: 50,
  notes: 10,
} as const;

export const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
  idempotentHint: true,
} as const;

export const NOAUTH_SECURITY_SCHEMES = [{ type: "noauth" as const }];
export const NOAUTH_TOOL_SECURITY = {
  securitySchemes: NOAUTH_SECURITY_SCHEMES,
} as const;

type RawListToolsHandler = (
  request: unknown,
  extra: unknown,
) => Promise<ListToolsResult> | ListToolsResult;

interface McpServerHandlerInternals {
  _requestHandlers: Map<string, RawListToolsHandler>;
}

export function exposeNoauthSecuritySchemes(server: McpServer): void {
  const internals = server.server as unknown as McpServerHandlerInternals;
  const originalHandler = internals._requestHandlers.get("tools/list");
  if (!originalHandler) {
    throw new Error("The MCP SDK tools/list handler is unavailable.");
  }

  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await originalHandler(request, extra);
    return {
      ...result,
      tools: result.tools.map((tool) => ({
        ...tool,
        securitySchemes: NOAUTH_SECURITY_SCHEMES,
      })),
    } as ListToolsResult;
  });
}

const scalarRecordSchema = z.record(
  z.string(),
  z.union([
    z.string().max(PUBLIC_OUTPUT_LIMITS.scalarChars),
    z.number(),
    z.null(),
  ]),
);

export const publicStructureOutputSchema = {
  source: z.enum(["attachment", "rcsb"]),
  pdbId: z.string().max(4).optional(),
  fileName: z.string().max(PUBLIC_OUTPUT_LIMITS.fileNameChars),
  format: z.string().max(PUBLIC_OUTPUT_LIMITS.scalarChars),
  kind: z.string().max(PUBLIC_OUTPUT_LIMITS.scalarChars),
  summaryLine: z.string().max(PUBLIC_OUTPUT_LIMITS.scalarChars),
  byteCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  counts: z.record(z.string(), z.number()),
  rows: z
    .array(
      z.object({
        label: z.string().max(PUBLIC_OUTPUT_LIMITS.scalarChars),
        value: z.string().max(PUBLIC_OUTPUT_LIMITS.scalarChars),
      }),
    )
    .max(PUBLIC_OUTPUT_LIMITS.rows),
  components: z.object({
    chains: z.array(scalarRecordSchema).max(PUBLIC_OUTPUT_LIMITS.componentItems).optional(),
    ligands: z.array(scalarRecordSchema).max(PUBLIC_OUTPUT_LIMITS.componentItems).optional(),
    ligandTypes: z.array(scalarRecordSchema).max(PUBLIC_OUTPUT_LIMITS.componentItems).optional(),
    ions: z.array(scalarRecordSchema).max(PUBLIC_OUTPUT_LIMITS.componentItems).optional(),
    water: z.record(z.string(), z.number()).optional(),
    molecules: z.array(scalarRecordSchema).max(PUBLIC_OUTPUT_LIMITS.componentItems).optional(),
    elements: z.record(z.string(), z.number()).optional(),
  }),
  notes: z
    .array(z.string().max(PUBLIC_OUTPUT_LIMITS.scalarChars))
    .max(PUBLIC_OUTPUT_LIMITS.notes),
  viewerAvailable: z.boolean(),
};

export const fileReferenceSchema = z.object({
  download_url: z.string().url().max(8192),
  file_id: z.string().min(1).max(256),
  mime_type: z.string().max(256).optional(),
  file_name: z.string().min(1).max(255).optional(),
});

export function viewerToolMeta(invoking: string, invoked: string) {
  return {
    securitySchemes: NOAUTH_SECURITY_SCHEMES,
    ui: { resourceUri: VIEWER_RESOURCE_URI, visibility: ["model"] as const },
    "openai/outputTemplate": VIEWER_RESOURCE_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
    "openai/widgetAccessible": false,
    "openai/resultCanProduceWidget": true,
  } as const;
}
