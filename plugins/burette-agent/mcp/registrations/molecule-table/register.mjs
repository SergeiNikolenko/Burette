import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { validateMolecularArtifact } from "../../lib/validation.mjs";
import { toolText } from "../../lib/tool-response.mjs";

export function registerMoleculeTable(server) {
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
}
