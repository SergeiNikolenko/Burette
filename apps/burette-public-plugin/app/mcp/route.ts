import { randomUUID } from "node:crypto";
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
  validateKetcherAction,
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
  hostedKetcherSnapshot,
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

const ketcherStructureSchema = z.object({
  format: z.enum(["ket", "mol", "rxn", "smiles"]),
  content: z.string().max(64 * 1024),
}).strict();

const ketcherActionInputSchema = z.object({
  apiVersion: z.literal(KETCHER_AGENT_API_VERSION),
  type: z.literal("control_ketcher"),
  command: z.enum(["set_structure", "clear_structure", "highlight_atoms", "get_structure", "request_persist"]),
  surfaceId: z.string().trim().min(1).max(160),
  actionId: z.string().trim().min(1).max(128).optional(),
  expectedRevision: z.number().int().min(0),
  format: z.string().trim().optional(),
  content: z.string().max(64 * 1024).optional(),
  contentRef: z.string().trim().max(1024).optional(),
  indexes: z.array(z.number().int().nonnegative()).max(256).optional(),
  formats: z.array(z.string().trim()).max(7).optional(),
  delivery: z.enum(["inline", "artifact", "download"]).optional(),
  suggestedBasename: z.string().trim().max(255).optional(),
}).strict();

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
      const snapshot = created.surface ? {
        apiVersion: KETCHER_AGENT_API_VERSION,
        surfaceId: created.surface.surfaceId,
        snapshot: hostedKetcherSnapshot(created.surface.surfaceId),
      } : null;
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
          ketcher: snapshot?.snapshot ?? null,
        },
        _meta: {
          ketcherSeed: seed,
          ketcher: snapshot?.snapshot ?? null,
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      ...NOAUTH_TOOL_SECURITY,
      _meta: ketcherToolMeta("Applying Ketcher action…", "Ketcher action complete"),
    },
    async ({ action: rawAction }) => {
      const action = rawAction.actionId
        ? rawAction
        : { ...rawAction, actionId: `ketcher-${randomUUID()}` };
      const validation = validateKetcherAction(action);
      if (!validation.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: validation.error.message }],
          structuredContent: { ok: false, error: validation.error, action },
        };
      }
      const result = executeHostedKetcherAction(validation.value);
      const seed = result.result?.ketcherSeed ?? null;
      return {
        content: [{ type: "text" as const, text: result.ok ? "Ketcher action complete." : result.error?.message || "Ketcher action failed." }],
        ...(result.ok ? {} : { isError: true }),
        structuredContent: {
          ok: result.ok,
          surfaceId: validation.value.surfaceId,
          result,
          snapshot: result.snapshot ?? null,
          action: validation.value,
        },
        _meta: {
          ketcherSeed: seed,
          ketcher: result.snapshot ?? null,
        },
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
      annotations: TOOL_ANNOTATIONS,
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
      annotations: TOOL_ANNOTATIONS,
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
