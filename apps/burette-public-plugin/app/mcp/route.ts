import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod/v4";
import {
  fileReferenceSchema,
  molecularSceneInputSchema,
  exposeNoauthSecuritySchemes,
  NOAUTH_SECURITY_SCHEMES,
  NOAUTH_TOOL_SECURITY,
  publicStructureOutputSchema,
  ketcherToolMeta,
  TOOL_ANNOTATIONS,
  viewerToolMeta,
} from "@/lib/contracts";
import {
  KETCHER_AGENT_API_VERSION,
  KETCHER_AGENT_ERROR_CODES,
  KETCHER_AGENT_LIMITS,
} from "@burette/ketcher-agent-contract";
import { getAppOrigin } from "@/lib/origin";
import {
  prepareAttachedStructure,
  preparePdbStructure,
  StructureServiceError,
} from "@/lib/structure-service";
import {
  createViewerResourceMeta,
  createViewerWidgetHtml,
  createKetcherResourceMeta,
  createKetcherWidgetHtml,
  KETCHER_RESOURCE_URI,
  VIEWER_RESOURCE_URI,
} from "@/lib/widget";
import {
  createHostedKetcherSurface,
  executeHostedKetcherAction,
} from "@/lib/ketcher-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Mcp-Session-Id, Last-Event-ID, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
} as const;

const ketcherInputFormats = ["ket", "mol", "rxn", "smiles"] as const;
const ketcherOutputFormats = ["ket", "mol", "rxn", "sdf", "smiles", "reaction_smiles", "cdxml"] as const;
const ketcherDeliveries = ["inline", "artifact", "download"] as const;
const ketcherCommands = ["set_structure", "clear_structure", "highlight_atoms", "get_structure", "request_persist"] as const;
const continuationTokenSchema = z.string().min(1).max(128 * 1024);
const actionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const surfaceIdSchema = z.string().min(1).max(160)
  .refine((value) => value.trim().length > 0, "surfaceId is required.");

function utf8BoundedString(maxBytes: number) {
  return z.string().max(maxBytes).refine(
    (value) => new TextEncoder().encode(value).byteLength <= maxBytes,
    `String must not exceed ${maxBytes} UTF-8 bytes.`,
  );
}

const inlineStructureContentSchema = utf8BoundedString(KETCHER_AGENT_LIMITS.inlineBytes);

const ketcherStructureSchema = z.object({
  format: z.enum(ketcherInputFormats),
  content: inlineStructureContentSchema,
}).strict();

const ketcherActionBase = {
  apiVersion: z.literal(KETCHER_AGENT_API_VERSION).optional(),
  type: z.literal("control_ketcher"),
  surfaceId: surfaceIdSchema,
  continuationToken: continuationTokenSchema,
  actionId: actionIdSchema,
  expectedRevision: z.number().int().min(0),
};

const ketcherActionInputSchema = z.union([
  z.object({
    ...ketcherActionBase,
    command: z.literal("set_structure"),
    format: z.enum(ketcherInputFormats),
    content: inlineStructureContentSchema,
  }).strict(),
  z.object({
    ...ketcherActionBase,
    command: z.literal("clear_structure"),
  }).strict(),
  z.object({
    ...ketcherActionBase,
    command: z.literal("highlight_atoms"),
    indexes: z.array(z.number().int().nonnegative())
      .max(KETCHER_AGENT_LIMITS.atomIndexes)
      .refine((indexes) => new Set(indexes).size === indexes.length, "indexes must be unique."),
  }).strict(),
  z.object({
    ...ketcherActionBase,
    command: z.literal("get_structure"),
    formats: z.array(z.enum(ketcherOutputFormats)).min(1).max(ketcherOutputFormats.length),
    delivery: z.enum(ketcherDeliveries).optional(),
  }).strict(),
  z.object({
    ...ketcherActionBase,
    command: z.literal("request_persist"),
    format: z.enum(ketcherOutputFormats),
    suggestedBasename: z.string()
      .trim()
      .min(1)
      .max(KETCHER_AGENT_LIMITS.textChars)
      .regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/u)
      .optional(),
  }).strict(),
]);

const ketcherErrorSchema = z.object({
  code: z.enum(KETCHER_AGENT_ERROR_CODES),
  message: z.string().max(KETCHER_AGENT_LIMITS.textChars),
}).strict();

const ketcherLastActionSchema = z.object({
  ok: z.literal(true),
  command: z.enum(ketcherCommands),
  actionId: actionIdSchema,
}).strict();

const ketcherSnapshotSchema = z.object({
  apiVersion: z.literal(KETCHER_AGENT_API_VERSION),
  surfaceId: surfaceIdSchema,
  phase: z.enum(["loading", "ready", "applying", "exporting", "recovering", "error", "disposed"]),
  structureRevision: z.number().int().nonnegative(),
  interactionRevision: z.number().int().nonnegative(),
  persistedRevision: z.number().int().nonnegative(),
  dirty: z.boolean(),
  structure: z.object({
    kind: z.enum(["empty", "molecule", "reaction"]),
    atomCount: z.number().int().nonnegative(),
    bondCount: z.number().int().nonnegative(),
    componentCount: z.number().int().nonnegative(),
    smiles: z.string().max(KETCHER_AGENT_LIMITS.smilesChars).nullable(),
    reactionSmiles: z.string().max(KETCHER_AGENT_LIMITS.reactionSmilesChars).nullable(),
    smilesOmitted: z.boolean(),
    reactionSmilesOmitted: z.boolean(),
  }).strict(),
  selectedAtoms: z.array(z.number().int().nonnegative()).max(256),
  selectedAtomCount: z.number().int().nonnegative(),
  selectionTruncated: z.boolean(),
  highlightedAtoms: z.array(z.number().int().nonnegative()).max(256),
  highlightedAtomCount: z.number().int().nonnegative(),
  highlightTruncated: z.boolean(),
  lastAction: ketcherLastActionSchema.nullable(),
  capabilities: z.object({
    setStructure: z.boolean(),
    highlightAtoms: z.boolean(),
    getStructure: z.boolean(),
    persist: z.boolean(),
  }).strict(),
}).strict();

const ketcherExportFormatsSchema = z.object({
  ket: inlineStructureContentSchema.optional(),
  mol: inlineStructureContentSchema.optional(),
  rxn: inlineStructureContentSchema.optional(),
  sdf: inlineStructureContentSchema.optional(),
  smiles: inlineStructureContentSchema.optional(),
  reaction_smiles: inlineStructureContentSchema.optional(),
  cdxml: inlineStructureContentSchema.optional(),
}).strict();

const hostedKetcherActionSuccessBase = {
  ok: z.literal(true),
  actionId: actionIdSchema,
  continuationToken: continuationTokenSchema,
  snapshot: ketcherSnapshotSchema,
};

const hostedKetcherActionSuccessSchema = z.union([
  z.object({
    ...hostedKetcherActionSuccessBase,
    command: z.literal("set_structure"),
    result: z.object({}).strict(),
  }).strict(),
  z.object({
    ...hostedKetcherActionSuccessBase,
    command: z.literal("clear_structure"),
    result: z.object({}).strict(),
  }).strict(),
  z.object({
    ...hostedKetcherActionSuccessBase,
    command: z.literal("highlight_atoms"),
    result: z.object({}).strict(),
  }).strict(),
  z.object({
    ...hostedKetcherActionSuccessBase,
    command: z.literal("get_structure"),
    result: z.object({
      delivery: z.enum(ketcherDeliveries),
      formats: ketcherExportFormatsSchema,
    }).strict(),
  }).strict(),
  z.object({
    ...hostedKetcherActionSuccessBase,
    command: z.literal("request_persist"),
    result: z.object({
      status: z.literal("awaiting_user"),
      format: z.enum(ketcherOutputFormats),
      suggestedBasename: z.string().min(1).max(KETCHER_AGENT_LIMITS.textChars),
    }).strict(),
  }).strict(),
]);

const hostedKetcherActionFailureSchema = z.object({
  ok: z.literal(false),
  command: z.enum(ketcherCommands),
  actionId: actionIdSchema,
  continuationToken: continuationTokenSchema.optional(),
  snapshot: ketcherSnapshotSchema.optional(),
  error: ketcherErrorSchema,
}).strict();

const hostedKetcherActionResultSchema = z.union([
  hostedKetcherActionSuccessSchema,
  hostedKetcherActionFailureSchema,
]);

const openKetcherOutputUnionSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    surfaceId: surfaceIdSchema,
    continuationToken: continuationTokenSchema,
    ketcher: ketcherSnapshotSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: ketcherErrorSchema,
  }).strict(),
]);

const controlKetcherOutputUnionSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    surfaceId: surfaceIdSchema,
    continuationToken: continuationTokenSchema,
    result: hostedKetcherActionSuccessSchema,
    snapshot: ketcherSnapshotSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    surfaceId: surfaceIdSchema,
    continuationToken: continuationTokenSchema.optional(),
    result: hostedKetcherActionFailureSchema,
    snapshot: ketcherSnapshotSchema.nullable(),
    error: ketcherErrorSchema,
  }).strict(),
]);

// The MCP SDK currently lists only object-root output schemas. Keep an object
// root for runtime validation and publish the same exact union through JSON Schema.
export const openKetcherOutputSchema = z.object({
  ok: z.boolean(),
  surfaceId: surfaceIdSchema.optional(),
  continuationToken: continuationTokenSchema.optional(),
  ketcher: ketcherSnapshotSchema.optional(),
  error: ketcherErrorSchema.optional(),
}).strict().superRefine((value, context) => {
  const parsed = openKetcherOutputUnionSchema.safeParse(value);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "Output must match exactly one open_ketcher result variant." });
  }
}).meta({
  oneOf: (z.toJSONSchema(openKetcherOutputUnionSchema, { io: "output" }) as { oneOf: unknown[] }).oneOf,
});

export const controlKetcherOutputSchema = z.object({
  ok: z.boolean(),
  surfaceId: surfaceIdSchema,
  continuationToken: continuationTokenSchema.optional(),
  result: hostedKetcherActionResultSchema,
  snapshot: ketcherSnapshotSchema.nullable(),
  error: ketcherErrorSchema.optional(),
}).strict().superRefine((value, context) => {
  const parsed = controlKetcherOutputUnionSchema.safeParse(value);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "Output must match exactly one control_ketcher result variant." });
  }
}).meta({
  oneOf: (z.toJSONSchema(controlKetcherOutputUnionSchema, { io: "output" }) as { oneOf: unknown[] }).oneOf,
});

function toolError(error: unknown) {
  const message =
    error instanceof StructureServiceError
      ? error.message
      : "Burette could not prepare this molecular structure.";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "burette-molecular-viewer",
    version: "0.1.0",
  });
  const appOrigin = getAppOrigin();

  registerAppResource(
    server,
    "burette-molecular-viewer",
    VIEWER_RESOURCE_URI,
    {
      title: "Burette",
      description:
        "Interactive Burette workspace for a bounded molecular structure result.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: VIEWER_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: createViewerWidgetHtml(appOrigin),
          _meta: createViewerResourceMeta(appOrigin),
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "burette-ketcher-editor",
    KETCHER_RESOURCE_URI,
    {
      title: "Burette Ketcher Editor",
      description: "Revision-checked Ketcher editor surface for Burette agent actions.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: KETCHER_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: createKetcherWidgetHtml(appOrigin),
          _meta: createKetcherResourceMeta(appOrigin),
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "open_ketcher",
    {
      title: "Open Ketcher Editor",
      description: "Open a bounded Ketcher chemical editor surface and optionally seed it with one inline structure.",
      inputSchema: {
        structure: ketcherStructureSchema.optional(),
      },
      outputSchema: openKetcherOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      ...NOAUTH_TOOL_SECURITY,
      _meta: ketcherToolMeta("Opening Ketcher editor…", "Ketcher editor ready"),
    },
    async ({ structure }) => {
      const created = createHostedKetcherSurface(structure);
      if (!created.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: created.error.message }],
          structuredContent: { ok: false, error: created.error },
        };
      }
      const snapshot = created.snapshot;
      const seed = created.surface.input
        ? {
            surfaceId: created.surface.surfaceId,
            format: created.surface.input.format,
            content: created.surface.input.content,
          }
        : null;
      return {
        content: [{ type: "text" as const, text: "Ketcher editor is ready." }],
        structuredContent: {
          ok: true,
          surfaceId: created.surface.surfaceId,
          continuationToken: created.continuationToken,
          ketcher: snapshot,
        },
        _meta: {
          ketcherSeed: seed,
          ketcher: snapshot,
          ketcherState: {
            surfaceId: created.surface.surfaceId,
            continuationToken: created.continuationToken,
          },
        },
      };
    },
  );

  registerAppTool(
    server,
    "control_ketcher",
    {
      title: "Control Ketcher Editor",
      description: "Apply a bounded, revision-checked action to a hosted Ketcher surface.",
      inputSchema: {
        action: ketcherActionInputSchema,
      },
      outputSchema: controlKetcherOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      ...NOAUTH_TOOL_SECURITY,
      _meta: ketcherToolMeta("Applying Ketcher action…", "Ketcher action complete"),
    },
    async ({ action }) => {
      const result = await executeHostedKetcherAction(action);
      const hasSeed = result.result && Object.hasOwn(result.result, "ketcherSeed");
      const ketcherSeed = hasSeed ? result.result?.ketcherSeed : undefined;
      const modelResult = hasSeed
        ? {
            ...result,
            result: Object.fromEntries(
              Object.entries(result.result!).filter(([key]) => key !== "ketcherSeed"),
            ),
          }
        : result;
      const meta = {
        ...(hasSeed ? { ketcherSeed } : {}),
        ketcher: result.snapshot ?? null,
        ...(result.continuationToken ? {
          ketcherState: {
            surfaceId: action.surfaceId,
            continuationToken: result.continuationToken,
          },
        } : {}),
      };
      if (result.ok) {
        return {
          content: [{ type: "text" as const, text: "Ketcher action complete." }],
          structuredContent: {
            ok: true as const,
            surfaceId: action.surfaceId,
            continuationToken: result.continuationToken!,
            result: modelResult,
            snapshot: result.snapshot!,
          },
          _meta: meta,
        };
      }
      return {
        content: [{ type: "text" as const, text: result.error?.message || "Ketcher action failed." }],
        isError: true,
        structuredContent: {
          ok: false as const,
          surfaceId: action.surfaceId,
          ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}),
          result: modelResult,
          snapshot: result.snapshot ?? null,
          error: result.error!,
        },
        _meta: meta,
      };
    },
  );

  registerAppTool(
    server,
    "preview_molecular_file",
    {
      title: "Preview a molecular file",
      description:
        "Read one attached PDB, ENT, PDBQT, CIF, mmCIF, SDF, SD, XYZ, or extended XYZ file, return bounded composition counts, and render an interactive 3D preview. The file is processed in memory and is not saved.",
      inputSchema: {
        structureFile: fileReferenceSchema.describe(
          "One ChatGPT-authorized molecular structure attachment.",
        ),
      },
      outputSchema: publicStructureOutputSchema,
      annotations: TOOL_ANNOTATIONS,
      ...NOAUTH_TOOL_SECURITY,
      _meta: {
        ...viewerToolMeta("Reading molecular file…", "Molecular file ready"),
        "openai/fileParams": ["structureFile"],
      },
    },
    async ({ structureFile }) => {
      try {
        const prepared = await prepareAttachedStructure(structureFile);
        return {
          content: [
            {
              type: "text" as const,
              text: prepared.summary.summaryLine,
            },
          ],
          structuredContent: prepared.summary,
          _meta: {
            structure: prepared.viewer,
            scene: {
              source: { kind: "attachment", fileName: prepared.summary.fileName },
              actions: [],
            },
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  registerAppTool(
    server,
    "render_molecular_scene",
    {
      title: "Render a molecular scene",
      description:
        "Use this when the user asks to select or focus part of a structure, clear the selection, reset the camera, or hide/show polymers, ligands, ions, or water. Re-render the PDB entry or authorized attachment with up to eight allowlisted viewer actions.",
      inputSchema: molecularSceneInputSchema,
      outputSchema: publicStructureOutputSchema,
      annotations: { ...TOOL_ANNOTATIONS, openWorldHint: true },
      ...NOAUTH_TOOL_SECURITY,
      _meta: {
        ...viewerToolMeta("Preparing molecular scene…", "Molecular scene ready"),
        "openai/fileParams": ["structureFile"],
      },
    },
    async (input) => {
      try {
        const prepared = input.source === "pdb"
          ? await preparePdbStructure(input.pdbId!)
          : await prepareAttachedStructure(input.structureFile!);
        const sourceDescriptor = input.source === "pdb"
          ? { kind: "pdb", pdbId: input.pdbId!.toUpperCase() }
          : {
              kind: "attachment",
              fileName: input.structureFile!.file_name ?? prepared.summary.fileName,
            };
        return {
          content: [{
            type: "text" as const,
            text: `${prepared.summary.summaryLine} ${input.actions.length} viewer action${input.actions.length === 1 ? " was" : "s were"} requested; the widget will report which actions were applied.`,
          }],
          structuredContent: prepared.summary,
          _meta: {
            structure: prepared.viewer,
            scene: { source: sourceDescriptor, actions: input.actions },
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  registerAppTool(
    server,
    "preview_pdb_structure",
    {
      title: "Preview a PDB structure",
      description:
        "Retrieve one public Protein Data Bank entry by its four-character PDB ID, return bounded composition counts, and render an interactive 3D preview. Use only when the user asks for a specific PDB entry.",
      inputSchema: {
        pdbId: z
          .string()
          .trim()
          .regex(/^[0-9][A-Za-z0-9]{3}$/u)
          .describe("Four-character PDB ID, for example 1CRN."),
      },
      outputSchema: publicStructureOutputSchema,
      annotations: { ...TOOL_ANNOTATIONS, openWorldHint: true },
      ...NOAUTH_TOOL_SECURITY,
      _meta: viewerToolMeta("Retrieving PDB structure…", "PDB structure ready"),
    },
    async ({ pdbId }) => {
      try {
        const prepared = await preparePdbStructure(pdbId);
        return {
          content: [
            {
              type: "text" as const,
              text: prepared.summary.summaryLine,
            },
          ],
          structuredContent: prepared.summary,
          _meta: {
            structure: prepared.viewer,
            scene: {
              source: { kind: "pdb", pdbId: pdbId.toUpperCase() },
              actions: [],
            },
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  exposeNoauthSecuritySchemes(server);

  return server;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  } catch {
    return withCors(
      Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
