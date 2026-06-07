import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { validateMolecularArtifact } from "../../lib/validation.mjs";
import { registerWidgetResource, toolText, widgetHtml } from "../../lib/widget-resource.mjs";

const WIDGET_URI = "ui://widget/burette-agent/molecule-table-20260607.html";

export function registerMoleculeTable(server) {
  registerWidgetResource(server, {
    name: "burette-molecule-table-widget",
    uri: WIDGET_URI,
    title: "Burrete Molecule Table",
    description: "A bounded molecule collection review table for SDF/property workflows.",
    html: widgetHtml("molecule-table"),
  });

  registerAppTool(
    server,
    "validate_molecule_collection_artifact",
    {
      title: "Validate Molecule Collection Artifact",
      description: "Validate a bounded molecule collection manifest and snapshot before rendering.",
      inputSchema: {
        manifest: z.record(z.unknown()),
        snapshot: z.record(z.unknown()),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const validation = validateMolecularArtifact({
        manifest: input.manifest,
        snapshot: input.snapshot,
        surface: "molecule-table",
      });
      return {
        content: toolText(validation.ok ? "Molecule collection artifact is valid." : "Molecule collection artifact has validation errors."),
        structuredContent: validation,
      };
    },
  );

  registerAppTool(
    server,
    "render_molecule_table_widget",
    {
      title: "Render Molecule Table Widget",
      description: "Render reviewed molecule rows in an inline table widget.",
      inputSchema: {
        title: z.string().trim().optional(),
        summary: z.string().trim().optional(),
        datasetId: z.string().trim().optional(),
        columns: z.array(z.record(z.unknown())).optional(),
        rows: z.array(z.record(z.unknown())).max(2000).optional(),
        snapshot: z.record(z.unknown()).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
      },
    },
    async input => ({
      content: toolText("Rendered molecule table widget."),
      structuredContent: {
        version: 1,
        widget: "molecule-table",
        title: input.title || "Molecule Table",
        rowCount: (input.rows || []).length,
        datasetId: input.datasetId || "molecules",
      },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        widgetData: input,
      },
    }),
  );
}
