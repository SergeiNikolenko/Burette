import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { validateMolecularArtifact } from "../../lib/validation.mjs";
import { toolText } from "../../lib/tool-response.mjs";

export function registerMolecularReport(server) {
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
}
