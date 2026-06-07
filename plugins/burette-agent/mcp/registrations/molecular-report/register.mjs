import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { validateMolecularArtifact } from "../../lib/validation.mjs";
import { registerWidgetResource, toolText, widgetHtml } from "../../lib/widget-resource.mjs";

const WIDGET_URI = "ui://widget/burette-agent/molecular-report-20260607.html";

export function registerMolecularReport(server) {
  registerWidgetResource(server, {
    name: "burette-molecular-report-widget",
    uri: WIDGET_URI,
    title: "Burrete Molecular Report",
    description: "A bounded report surface for molecular notes, tables, charts, sources, and workflow provenance.",
    html: widgetHtml("molecular-report"),
  });

  registerAppTool(
    server,
    "validate_molecular_report_artifact",
    {
      title: "Validate Molecular Report Artifact",
      description: "Validate a bounded molecular report manifest and snapshot before rendering.",
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
        surface: "molecular-report",
      });
      return {
        content: toolText(validation.ok ? "Molecular report artifact is valid." : "Molecular report artifact has validation errors."),
        structuredContent: validation,
      };
    },
  );

  registerAppTool(
    server,
    "render_molecular_report_widget",
    {
      title: "Render Molecular Report Widget",
      description: "Render a validated molecular report manifest and bounded snapshot in an inline widget.",
      inputSchema: {
        manifest: z.record(z.unknown()),
        snapshot: z.record(z.unknown()),
        packageInfo: z.record(z.unknown()).optional(),
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
    async input => {
      const validation = validateMolecularArtifact({
        manifest: input.manifest,
        snapshot: input.snapshot,
        surface: "molecular-report",
      });
      if (!validation.ok) {
        return {
          content: toolText("Molecular report artifact has validation errors; render blocked."),
          structuredContent: validation,
        };
      }
      return {
        content: toolText("Rendered molecular report widget."),
        structuredContent: {
          version: 1,
          widget: "molecular-report",
          title: input.manifest.title,
          datasetCount: validation.summary.datasetCount,
          inlineBytes: validation.summary.inlineBytes,
        },
        _meta: {
          "openai/outputTemplate": WIDGET_URI,
          widgetData: input,
        },
      };
    },
  );
}
