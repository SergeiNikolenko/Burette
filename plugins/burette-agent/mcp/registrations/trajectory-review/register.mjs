import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { validateMolecularArtifact } from "../../lib/validation.mjs";
import { registerWidgetResource, toolText, widgetHtml } from "../../lib/widget-resource.mjs";

const WIDGET_URI = "ui://widget/burette-agent/trajectory-review-20260607.html";

export function registerTrajectoryReview(server) {
  registerWidgetResource(server, {
    name: "burette-trajectory-review-widget",
    uri: WIDGET_URI,
    title: "Burrete Trajectory Review",
    description: "A bounded review surface for trajectory metrics, representative frames, and result-bundle artifacts.",
    html: widgetHtml("trajectory-review"),
  });

  registerAppTool(
    server,
    "validate_trajectory_review_artifact",
    {
      title: "Validate Trajectory Review Artifact",
      description: "Validate a bounded trajectory review manifest and snapshot before rendering.",
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
        surface: "trajectory-review",
      });
      return {
        content: toolText(validation.ok ? "Trajectory review artifact is valid." : "Trajectory review artifact has validation errors."),
        structuredContent: validation,
      };
    },
  );

  registerAppTool(
    server,
    "render_trajectory_review_widget",
    {
      title: "Render Trajectory Review Widget",
      description: "Render trajectory metrics and artifacts in an inline review widget.",
      inputSchema: {
        title: z.string().trim().optional(),
        summary: z.string().trim().optional(),
        status: z.string().trim().optional(),
        metrics: z.array(z.record(z.unknown())).max(64).optional(),
        artifacts: z.array(z.record(z.unknown())).max(128).optional(),
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
      content: toolText("Rendered trajectory review widget."),
      structuredContent: {
        version: 1,
        widget: "trajectory-review",
        title: input.title || "Trajectory Review",
        metricCount: (input.metrics || []).length,
        artifactCount: (input.artifacts || input.snapshot?.artifacts || []).length,
      },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        widgetData: input,
      },
    }),
  );
}
