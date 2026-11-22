import { randomUUID } from "node:crypto";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import {
  APP_ONLY_TOOL_META,
  entrypointToolMeta,
  fileEntrypointInputSchema,
  fileReferenceSchema,
  molecularSceneInputSchema,
  SKETCH_FILE_EXTENSIONS,
  STRUCTURE_FILE_EXTENSIONS,
  exposeNoauthSecuritySchemes,
  NOAUTH_SECURITY_SCHEMES,
  NOAUTH_TOOL_SECURITY,
  publicStructureOutputSchema,
  ketcherToolMeta,
  RCSB_TOOL_ANNOTATIONS,
  TOOL_ANNOTATIONS,
  viewerToolMeta,
} from "@/lib/contracts";
import {
  KETCHER_AGENT_API_VERSION,
  validateKetcherAction,
} from "@burette/ketcher-agent-contract";
import { getAppOrigin } from "@/lib/origin";
import { searchPdbMentions } from "@/lib/pdb-mentions";
import {
  MAX_PUBLIC_STRUCTURE_BYTES,
  prepareAttachedStructure,
  preparePdbStructure,
  prepareStructureText,
  StructureServiceError,
  structureSummaryText,
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
  hostedKetcherInitialSeed,
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

const ketcherErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
}).strict();

const ketcherSnapshotSchema = z.object({
  apiVersion: z.literal(KETCHER_AGENT_API_VERSION),
  surfaceId: z.string(),
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
    smiles: z.string().nullable(),
    reactionSmiles: z.string().nullable(),
    smilesOmitted: z.boolean(),
    reactionSmilesOmitted: z.boolean(),
  }).strict(),
  selectedAtoms: z.array(z.number().int().nonnegative()).max(256),
  selectedAtomCount: z.number().int().nonnegative(),
  selectionTruncated: z.boolean(),
  highlightedAtoms: z.array(z.number().int().nonnegative()).max(256),
  highlightedAtomCount: z.number().int().nonnegative(),
  highlightTruncated: z.boolean(),
  lastAction: z.unknown().nullable(),
  capabilities: z.record(z.string(), z.boolean()),
}).strict();

const openKetcherOutputSchema = {
  ok: z.boolean(),
  surfaceId: z.string().optional(),
  ketcher: ketcherSnapshotSchema.nullable().optional(),
  error: ketcherErrorSchema.optional(),
};

const hostedKetcherActionResultSchema = z.object({
  ok: z.boolean(),
  command: z.string(),
  actionId: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  snapshot: ketcherSnapshotSchema.optional(),
  error: ketcherErrorSchema.optional(),
}).strict();

const controlKetcherOutputSchema = {
  ok: z.boolean(),
  surfaceId: z.string().optional(),
  result: hostedKetcherActionResultSchema.optional(),
  snapshot: ketcherSnapshotSchema.nullable().optional(),
  action: ketcherActionInputSchema.optional(),
  error: ketcherErrorSchema.optional(),
};

const entrypointOutputSchema = { entrypoint: z.enum(["thread", "global", "file"]) };
const mentionsOutputSchema = {
  items: z.array(z.object({
    type: z.literal("resource_link"),
    uri: z.string(),
    name: z.string(),
    title: z.string(),
    description: z.string(),
    mimeType: z.literal("text/html"),
  })),
};

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

function ketcherReadyText(snapshot: ReturnType<typeof hostedKetcherSnapshot> | undefined): string {
  const structure = snapshot?.structure;
  if (!snapshot || !structure || structure.kind === "empty") return `Molecular editor is ready with an empty canvas at structure revision ${snapshot?.structureRevision ?? 0}.`;
  const smiles = structure.smiles ? ` (SMILES ${structure.smiles})` : "";
  return `Molecular editor is ready with a ${structure.kind} of ${structure.atomCount} atoms and ${structure.bondCount} bonds${smiles} at structure revision ${snapshot.structureRevision}. Nothing was written to a file.`;
}

function createServer(): McpServer {
  const appOrigin = getAppOrigin();
  // Hosts show this icon next to widget context cards above the composer.
  const server = new McpServer({
    name: "burette-molecular-viewer",
    title: "Burette",
    version: "0.1.0",
    icons: [{ src: `${appOrigin}/icons/burette-app-icon.png`, mimeType: "image/png", sizes: ["512x512"] }],
  }, {
    // Codex finds the composer mention search through this capability; the
    // per-tool "mentions/search" marker is only its deprecated fallback.
    capabilities: { extensions: { "openai/mentions": { searchTool: "search_pdb_mentions" } } },
  });

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
      title: "Burette Molecular Editor",
      description: "Revision-checked molecular editor surface for Burette agent actions.",
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
    "open_molecular_editor",
    {
      title: "Open Molecular Editor",
      description: "Open Burette's molecular editor inline in chat and optionally seed it with one inline structure (SMILES, MOL, KET, or an RXN reaction).",
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
      _meta: ketcherToolMeta("Opening molecular editor…", "Molecular editor ready"),
    },
    async ({ structure }: { structure?: z.infer<typeof ketcherStructureSchema> }) => {
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
        content: [{ type: "text" as const, text: ketcherReadyText(snapshot?.snapshot) }],
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
    "control_molecular_editor",
    {
      title: "Control Molecular Editor",
      description: "Apply a bounded, revision-checked action to an open molecular editor surface.",
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
      _meta: ketcherToolMeta("Applying editor action…", "Editor action complete"),
    },
    async ({ action: rawAction }: { action: z.infer<typeof ketcherActionInputSchema> }) => {
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
      const result = executeHostedKetcherAction(action);
      return {
        content: [{ type: "text" as const, text: result.ok ? "Molecular editor action complete." : result.error?.message || "Molecular editor action failed." }],
        ...(result.ok ? {} : { isError: true }),
        structuredContent: {
          ok: result.ok,
          surfaceId: validation.value.surfaceId,
          result,
          snapshot: result.snapshot ?? null,
          action,
        },
        _meta: {
          ...(result.ok ? { ketcherInitialSeed: hostedKetcherInitialSeed(validation.value.surfaceId) } : {}),
          ...(result.ok && result.result && Object.hasOwn(result.result, "ketcherSeed")
            ? { ketcherSeed: result.result.ketcherSeed }
            : {}),
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
      outputSchema: z.object(publicStructureOutputSchema),
      annotations: TOOL_ANNOTATIONS,
      ...NOAUTH_TOOL_SECURITY,
      _meta: {
        ...viewerToolMeta("Reading molecular file…", "Molecular file ready"),
        "openai/fileParams": ["structureFile"],
      },
    },
    async ({ structureFile }: { structureFile: z.infer<typeof fileReferenceSchema> }) => {
      try {
        const prepared = await prepareAttachedStructure(structureFile);
        return {
          content: [
            {
              type: "text" as const,
              text: structureSummaryText(prepared.summary),
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
        "Open a PDB entry or authorized attachment AND apply up to eight viewer actions in ONE call. Use directly when the user asks to select/focus a ligand or residues, reset the camera, or hide/show components. Require a source explicitly identified in this conversation; if missing, ask for a file or PDB ID instead of borrowing one from cached widget context or another chat. Do not call preview_pdb_structure or preview_molecular_file first when the source and selector are already provided. This tool loads the structure itself. Never repeat the same call to poll for rendering or confirm success: each call creates another scene card, not a status check. If applied-action acknowledgement is absent, state that rendering is unconfirmed rather than retrying. The result confirms preparation only, not a displayed scene or applied actions; claim completion only after the widget reports applied actions.",
      inputSchema: molecularSceneInputSchema,
      outputSchema: z.object(publicStructureOutputSchema),
      annotations: RCSB_TOOL_ANNOTATIONS,
      ...NOAUTH_TOOL_SECURITY,
      _meta: {
        ...viewerToolMeta("Preparing molecular scene…", "Molecular scene prepared"),
        "openai/fileParams": ["structureFile"],
      },
    },
    async (input: z.infer<typeof molecularSceneInputSchema>) => {
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
            text: `${structureSummaryText(prepared.summary)} ${input.actions.length} viewer action${input.actions.length === 1 ? " was" : "s were"} requested; the widget will report which actions were applied. Do not repeat this request as a status check: it would create a duplicate card. Without a widget acknowledgement, report preparation only, not completion.`,
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
        "Retrieve one public Protein Data Bank entry by its four-character PDB ID, return bounded composition counts, and open an interactive preview of the supplied coordinates, not a generated biological assembly. Call once for an explicitly requested inspection; the same result already contains composition counts, so do not repeat the call to obtain them. Do NOT call this tool as a substitute for unsupported docking, affinity scoring, simulation, or local-file overwrite requests, even if a PDB ID is mentioned: explain the limitation first and offer inspection without opening a viewer unless requested. For requests that also select, focus, or hide/show components, use render_molecular_scene directly instead; do not preview first. Prepared data is not proof that the widget has displayed it.",
      inputSchema: {
        pdbId: z
          .string()
          .trim()
          .regex(/^[0-9][A-Za-z0-9]{3}$/u)
          .describe("Four-character PDB ID, for example 1CRN."),
      },
      outputSchema: z.object(publicStructureOutputSchema),
      annotations: RCSB_TOOL_ANNOTATIONS,
      ...NOAUTH_TOOL_SECURITY,
      _meta: viewerToolMeta("Retrieving PDB structure…", "PDB structure ready"),
    },
    async ({ pdbId }: { pdbId: string }) => {
      try {
        const prepared = await preparePdbStructure(pdbId);
        return {
          content: [
            {
              type: "text" as const,
              text: structureSummaryText(prepared.summary),
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

  // Thread and global entrypoints open the empty workspace as a tab beside the
  // chat or as the Burette app in the sidebar. A thread tab title should not
  // repeat the plugin name, while the sidebar app keeps it.
  for (const [name, type, title, description] of [
    ["open_workspace_tab", "thread", "Molecule Workspace", "Open an empty Burette workspace beside the conversation."],
    ["open_app", "global", "Burette", "Open the Burette workspace from the sidebar."],
  ] as const) {
    registerAppTool(
      server,
      name,
      {
        title,
        description,
        inputSchema: {},
        outputSchema: entrypointOutputSchema,
        annotations: TOOL_ANNOTATIONS,
        ...NOAUTH_TOOL_SECURITY,
        _meta: entrypointToolMeta(VIEWER_RESOURCE_URI, { type }),
      },
      async () => ({
        content: [{ type: "text" as const, text: "Burette workspace opened." }],
        structuredContent: { entrypoint: type },
        _meta: { workspace: { entrypoint: type } },
      }),
    );
  }

  server.registerTool(
    "search_pdb_mentions",
    {
      title: "Burette structures",
      description: "Composer at-mention search for PDB entries. Called by the host, not the model.",
      inputSchema: { query: z.string().max(200) },
      outputSchema: mentionsOutputSchema,
      annotations: RCSB_TOOL_ANNOTATIONS,
      ...NOAUTH_TOOL_SECURITY,
      _meta: { ...APP_ONLY_TOOL_META, "openai/extensions": { "mentions/search": {} } },
    },
    async ({ query }) => {
      try {
        return { content: [], structuredContent: { items: await searchPdbMentions(query) } };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // The widget reads the opened file from the host and sends its text to
  // prepare_structure_content; the host never shares the file with the server.
  registerAppTool(
    server,
    "open_structure_file",
    {
      title: "Burette",
      description: "Open a molecular structure file in Burette's viewer.",
      inputSchema: fileEntrypointInputSchema,
      outputSchema: entrypointOutputSchema,
      annotations: TOOL_ANNOTATIONS,
      ...NOAUTH_TOOL_SECURITY,
      _meta: entrypointToolMeta(VIEWER_RESOURCE_URI, { type: "file", extensions: STRUCTURE_FILE_EXTENSIONS }),
    },
    async ({ file }: { file: { name: string } }) => ({
      content: [{ type: "text" as const, text: `Opening ${file.name} in Burette.` }],
      structuredContent: { entrypoint: "file" as const },
      _meta: { workspace: { entrypoint: "file" } },
    }),
  );

  registerAppTool(
    server,
    "open_sketch_file",
    {
      title: "Burette Molecular Editor",
      description: "Open a molecule or reaction file in Burette's molecular editor.",
      inputSchema: fileEntrypointInputSchema,
      outputSchema: entrypointOutputSchema,
      annotations: TOOL_ANNOTATIONS,
      ...NOAUTH_TOOL_SECURITY,
      _meta: entrypointToolMeta(KETCHER_RESOURCE_URI, { type: "file", extensions: SKETCH_FILE_EXTENSIONS }),
    },
    async ({ file }: { file: { name: string } }) => ({
      content: [{ type: "text" as const, text: `Opening ${file.name} in the molecular editor.` }],
      structuredContent: { entrypoint: "file" as const },
      _meta: { workspace: { entrypoint: "file" } },
    }),
  );

  registerAppTool(
    server,
    "prepare_structure_content",
    {
      title: "Prepare molecular file content",
      description: "Summarize the text of a molecular file the user opened in Burette and prepare it for the viewer.",
      inputSchema: {
        fileName: z.string().trim().min(1).max(255),
        content: z.string().max(MAX_PUBLIC_STRUCTURE_BYTES),
      },
      outputSchema: z.object(publicStructureOutputSchema),
      annotations: TOOL_ANNOTATIONS,
      ...NOAUTH_TOOL_SECURITY,
      _meta: APP_ONLY_TOOL_META,
    },
    async ({ fileName, content }: { fileName: string; content: string }) => {
      try {
        const prepared = prepareStructureText(content, fileName, "attachment");
        return {
          content: [{ type: "text" as const, text: structureSummaryText(prepared.summary) }],
          structuredContent: prepared.summary,
          _meta: {
            structure: prepared.viewer,
            scene: { source: { kind: "attachment", fileName: prepared.summary.fileName }, actions: [] },
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
