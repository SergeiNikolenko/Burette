import { z } from "zod/v4";
import { ListToolsResultSchema } from "@modelcontextprotocol/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { KETCHER_RESOURCE_URI, VIEWER_RESOURCE_URI } from "./widget";

export const PUBLIC_OUTPUT_LIMITS = {
  scalarChars: 512,
  fileNameChars: 255,
  rows: 12,
  componentItems: 50,
  notes: 10,
} as const;

export const MAX_PUBLIC_GRID_INLINE_MOLECULES = 500;
const MAX_INLINE_GRID_CONTENT_BYTES = 3 * 1024 * 1024;

export const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
  idempotentHint: true,
} as const;

// Tools that may read a public RCSB entry reach the public internet.
export const RCSB_TOOL_ANNOTATIONS = { ...TOOL_ANNOTATIONS, openWorldHint: true } as const;

export const NOAUTH_SECURITY_SCHEMES = [{ type: "noauth" as const }];
export const NOAUTH_TOOL_SECURITY = {
  securitySchemes: NOAUTH_SECURITY_SCHEMES,
} as const;

// Monochrome 20x20 currentColor Burette Cloud glyph (atom + cloud cutout badge)
// matching Codex sidebar/tab icon geometry (1.33px strokes, no tile frame).
const BURETTE_CLOUD_SIDEBAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round">' +
  '<defs><mask id="burette-cloud-cut"><rect width="20" height="20" fill="white"/><path d="M10.4 18.6H16.9C18.5 18.6 19.7 17.4 19.7 15.8C19.7 14.4 18.6 13.2 17.3 13.0C16.9 11.0 15.2 9.6 13.2 9.6C11.5 9.6 10.0 10.7 9.4 12.2C8.1 12.6 7.2 13.8 7.2 15.2C7.2 17.1 8.6 18.6 10.4 18.6Z" fill="black"/></mask></defs>' +
  '<g mask="url(#burette-cloud-cut)"><ellipse cx="8.6" cy="8.6" rx="6.6" ry="2.7"/><ellipse cx="8.6" cy="8.6" rx="6.6" ry="2.7" transform="rotate(60 8.6 8.6)"/><ellipse cx="8.6" cy="8.6" rx="6.6" ry="2.7" transform="rotate(-60 8.6 8.6)"/><circle cx="8.6" cy="8.6" r="1.2" fill="currentColor" stroke="none"/></g>' +
  '<path d="M11.1 17.6H16.4C17.6 17.6 18.5 16.7 18.5 15.55C18.5 14.48 17.68 13.6 16.62 13.5C16.36 12.05 15.1 10.95 13.55 10.95C12.22 10.95 11.1 11.78 10.65 12.94C9.62 13.15 8.85 14.06 8.85 15.15C8.85 16.5 9.86 17.6 11.1 17.6Z" stroke-width="1.33"/></svg>';

export const BURETTE_CLOUD_ICONS = [
  {
    src: `data:image/svg+xml;base64,${Buffer.from(BURETTE_CLOUD_SIDEBAR_SVG).toString("base64")}`,
    mimeType: "image/svg+xml",
    sizes: ["any"],
  },
];

const CLOUD_ENTRYPOINT_TOOL_NAMES = new Set([
  "open_app",
  "open_workspace_tab",
  "open_structure_file",
  "open_sketch_file",
  "search_pdb_mentions",
]);

type ListToolsResult = z.infer<typeof ListToolsResultSchema>;

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

  server.server.setRequestHandler("tools/list", async (request, extra) => {
    const result = await originalHandler(request, extra);
    return {
      ...result,
      tools: result.tools.map((tool) => ({
        ...tool,
        securitySchemes: NOAUTH_SECURITY_SCHEMES,
        ...(CLOUD_ENTRYPOINT_TOOL_NAMES.has(tool.name) ? { icons: BURETTE_CLOUD_ICONS } : {}),
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
  source: z.enum(["attachment", "rcsb", "inline"]),
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

export const moleculeGridItemSchema = z.object({
  smiles: z.string().trim().min(1).max(4096),
  name: z.string().trim().max(PUBLIC_OUTPUT_LIMITS.fileNameChars).optional(),
  properties: z.record(
    z.string().trim().min(1).max(128),
    z.union([
      z.string().max(PUBLIC_OUTPUT_LIMITS.scalarChars),
      z.number(),
      z.boolean(),
      z.null(),
    ]),
  ).optional(),
}).strict();

export type MoleculeGridItem = z.infer<typeof moleculeGridItemSchema>;

export const moleculeGridInputSchema = z.object({
  molecules: z.array(moleculeGridItemSchema).min(1).max(MAX_PUBLIC_GRID_INLINE_MOLECULES).optional()
    .describe("Inline molecules (SMILES, optional name, and optional scalar properties) to display in Burette's interactive molecule grid."),
  content: z.string().min(1).max(MAX_INLINE_GRID_CONTENT_BYTES).optional()
    .describe("Inline CSV, TSV, SMILES, SDF, or DataWarrior (.dwar) text containing molecules."),
  format: z.enum(["csv", "tsv", "smiles", "sdf", "dwar"]).optional()
    .describe("Format of inline content or attachment (csv, tsv, smiles, sdf, or dwar)."),
  gridFile: fileReferenceSchema.optional()
    .describe("One ChatGPT-authorized CSV, TSV, SMI, SMILES, SDF, SD, or DWAR attachment."),
  title: z.string().trim().min(1).max(PUBLIC_OUTPUT_LIMITS.fileNameChars).optional()
    .describe("Optional title or filename for the molecule grid, for example tests_sample.tsv or SAR series."),
}).strict().superRefine((input, context) => {
  const provided = [
    input.molecules !== undefined,
    input.content !== undefined,
    input.gridFile !== undefined,
  ].filter(Boolean).length;
  if (provided === 0) {
    context.addIssue({
      code: "custom",
      path: ["molecules"],
      message: "Provide one of molecules, content, or gridFile.",
    });
  } else if (provided > 1) {
    context.addIssue({
      code: "custom",
      path: ["molecules"],
      message: "Provide only one of molecules, content, or gridFile.",
    });
  }
  if (input.content !== undefined && !input.format) {
    const ext = input.title ? input.title.split(".").pop()?.toLowerCase() : "";
    if (!["csv", "tsv", "smi", "smiles", "sdf", "sd", "dwar"].includes(ext ?? "")) {
      context.addIssue({
        code: "custom",
        path: ["format"],
        message: "Specify format (csv, tsv, smiles, sdf, or dwar) when passing inline content without a matching file extension in title.",
      });
    }
  }
});

export type MoleculeGridInput = z.infer<typeof moleculeGridInputSchema>;

export const viewerSelectorSchema = z.object({
  kind: z.enum(["all", "polymer", "protein", "nucleic", "ligand", "ion", "water"]).optional(),
  auth_asym_id: z.string().trim().min(1).max(32).optional(),
  label_asym_id: z.string().trim().min(1).max(32).optional(),
  auth_comp_id: z.string().trim().min(1).max(16).optional(),
  label_comp_id: z.string().trim().min(1).max(16).optional(),
  auth_seq_id: z.number().int().optional(),
  label_seq_id: z.number().int().optional(),
  beg_auth_seq_id: z.number().int().optional(),
  end_auth_seq_id: z.number().int().optional(),
  beg_label_seq_id: z.number().int().optional(),
  end_label_seq_id: z.number().int().optional(),
}).strict();

const selectActionSchema = z.object({
  type: z.literal("select_residues"),
  selector: viewerSelectorSchema,
  mode: z.literal("replace").optional(),
  granularity: z.enum(["atom", "residue", "chain"]).optional(),
  label: z.string().trim().max(128).optional(),
}).strict();

const focusActionSchema = z.object({
  type: z.literal("focus_selection"),
  selector: viewerSelectorSchema.optional(),
}).strict();

const visibilityActionSchema = z.object({
  type: z.enum(["hide_components", "show_components"]),
  kind: z.enum(["polymer", "ligand", "ion", "water"]),
}).strict();

export const viewerActionSchema = z.discriminatedUnion("type", [
  selectActionSchema,
  focusActionSchema,
  visibilityActionSchema,
  z.object({ type: z.literal("clear_selection") }).strict(),
  z.object({ type: z.literal("reset_camera") }).strict(),
]);

const sceneActionsSchema = z.array(viewerActionSchema).min(1).max(8);

export const molecularSceneInputSchema = z.object({
  source: z.enum(["pdb", "attachment"]),
  pdbId: z.string().trim().regex(/^[0-9][A-Za-z0-9]{3}$/u).optional(),
  structureFile: fileReferenceSchema.optional(),
  actions: sceneActionsSchema,
}).strict().superRefine((input, context) => {
  if (input.source === "pdb" && !input.pdbId) {
    context.addIssue({
      code: "custom",
      path: ["pdbId"],
      message: "pdbId is required when source is pdb.",
    });
  }
  if (input.source === "attachment" && !input.structureFile) {
    context.addIssue({
      code: "custom",
      path: ["structureFile"],
      message: "structureFile is required when source is attachment.",
    });
  }
  if (input.source === "pdb" && input.structureFile) {
    context.addIssue({
      code: "custom",
      path: ["structureFile"],
      message: "structureFile is only valid when source is attachment.",
    });
  }
  if (input.source === "attachment" && input.pdbId) {
    context.addIssue({
      code: "custom",
      path: ["pdbId"],
      message: "pdbId is only valid when source is pdb.",
    });
  }
});

export function viewerToolMeta(invoking: string, invoked: string) {
  return {
    securitySchemes: NOAUTH_SECURITY_SCHEMES,
    ui: { resourceUri: VIEWER_RESOURCE_URI },
    "openai/outputTemplate": VIEWER_RESOURCE_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
    "openai/widgetAccessible": false,
    "openai/resultCanProduceWidget": true,
  } as const;
}

// Codex opens these files in Burette from the file tree or a chat file chip.
// The host matches extensions with their leading dot and drops the whole
// entrypoint list if any entry is malformed.
export const STRUCTURE_FILE_EXTENSIONS = [".pdb", ".ent", ".pdbqt", ".cif", ".mmcif", ".sdf", ".sd", ".xyz", ".extxyz"];
export const SKETCH_FILE_EXTENSIONS = [".mol", ".smi", ".smiles", ".ket", ".rxn"];

// The host passes the opened file as an opaque resource the widget reads
// through the host; the server never sees the file or its local path.
export const fileEntrypointInputSchema = {
  file: z.object({
    name: z.string().trim().min(1).max(255),
    resourceUri: z.string().trim().min(1).max(4096),
  }),
};

type Entrypoint = { type: "thread" } | { type: "global" } | { type: "file"; extensions: string[] };

/** Metadata for a tool the host invokes as an entrypoint, never the model. */
export function entrypointToolMeta(resourceUri: string, entrypoint: Entrypoint) {
  return {
    securitySchemes: NOAUTH_SECURITY_SCHEMES,
    ui: { resourceUri, visibility: ["app"] },
    "openai/outputTemplate": resourceUri,
    "openai/ui": { entrypoints: [entrypoint] },
  } as const;
}

/** Metadata for a tool only the mounted widget calls. */
export const APP_ONLY_TOOL_META = {
  securitySchemes: NOAUTH_SECURITY_SCHEMES,
  ui: { visibility: ["app"] },
} as const;

export function ketcherToolMeta(invoking: string, invoked: string) {
  return {
    securitySchemes: NOAUTH_SECURITY_SCHEMES,
    ui: { resourceUri: KETCHER_RESOURCE_URI },
    "openai/outputTemplate": KETCHER_RESOURCE_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  } as const;
}
