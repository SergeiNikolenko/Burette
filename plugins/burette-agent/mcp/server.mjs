import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { pluginPath } from "./lib/plugin-root.mjs";
import { registerFetch } from "./registrations/fetch/register.mjs";
import { registerMolecularReport } from "./registrations/molecular-report/register.mjs";
import { registerMolecularWorkspace } from "./registrations/molecular-workspace/register.mjs";
import { registerMvsStory } from "./registrations/mvs-story/register.mjs";
import { registerMoleculeTable } from "./registrations/molecule-table/register.mjs";
import { registerTrajectoryReview } from "./registrations/trajectory-review/register.mjs";
import { registerLocalViewer } from "./registrations/local-viewer/register.mjs";
import { registerDeepLinks } from "./registrations/deep-links/register.mjs";

const pluginManifest = JSON.parse(readFileSync(pluginPath(".codex-plugin", "plugin.json"), "utf8"));

const server = new McpServer(
  {
    name: pluginManifest.name,
    version: pluginManifest.version,
  },
  {
    instructions:
      "Operate Burette molecular workspaces through tools. Requests to color chains, focus ligands or edit sketches are live workspace actions, not requests to search or edit Burette source code. Reuse this task's sessionId, observe readiness and await a control acknowledgement. Use capture_scene through control_inline_viewer to see actual scene PNGs; a selected ligand adds matching 2D. Skills own detailed workflow routing. Tool catalogs are context, not a new request to install plugins.",
  },
);

registerFetch(server);
registerMolecularWorkspace(server);
registerDeepLinks(server);
registerMvsStory(server);
registerMoleculeTable(server);
registerTrajectoryReview(server);
registerMolecularReport(server);
await registerLocalViewer(server);

const transport = new StdioServerTransport();
await server.connect(transport);
