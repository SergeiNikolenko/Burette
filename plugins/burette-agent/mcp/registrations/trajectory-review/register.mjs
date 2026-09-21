import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { validateMolecularArtifact } from "../../lib/validation.mjs";
import { toolText } from "../../lib/tool-response.mjs";

export function registerTrajectoryReview(server) {
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
}
