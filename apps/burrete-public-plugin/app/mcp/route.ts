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
  exposeNoauthSecuritySchemes,
  NOAUTH_SECURITY_SCHEMES,
  NOAUTH_TOOL_SECURITY,
  publicStructureOutputSchema,
  TOOL_ANNOTATIONS,
  viewerToolMeta,
} from "@/lib/contracts";
import { getAppOrigin } from "@/lib/origin";
import {
  prepareAttachedStructure,
  preparePdbStructure,
  StructureServiceError,
} from "@/lib/structure-service";
import {
  createViewerResourceMeta,
  createViewerWidgetHtml,
  VIEWER_RESOURCE_URI,
} from "@/lib/widget";

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

function toolError(error: unknown) {
  const message =
    error instanceof StructureServiceError
      ? error.message
      : "Burrete could not prepare this molecular structure.";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "burrete-molecular-viewer",
    version: "0.1.0",
  });
  const appOrigin = getAppOrigin();

  registerAppResource(
    server,
    "burrete-molecular-viewer",
    VIEWER_RESOURCE_URI,
    {
      title: "Burrete",
      description:
        "Interactive Burrete workspace for a bounded molecular structure result.",
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
          _meta: { structure: prepared.viewer },
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
          _meta: { structure: prepared.viewer },
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
