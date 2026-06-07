import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { pluginPath } from "./lib/plugin-root.mjs";
import { registerMolecularReport } from "./registrations/molecular-report/register.mjs";
import { registerMolecularWorkspace } from "./registrations/molecular-workspace/register.mjs";
import { registerMoleculeTable } from "./registrations/molecule-table/register.mjs";
import { registerTrajectoryReview } from "./registrations/trajectory-review/register.mjs";

const pluginManifest = JSON.parse(readFileSync(pluginPath(".codex-plugin", "plugin.json"), "utf8"));

const server = new McpServer(
  {
    name: pluginManifest.name,
    version: pluginManifest.version,
  },
  {
    instructions:
      "Expose Burrete tools and widgets. Skills own workflow routing. MCP tools wrap the repository CLI, validate bounded molecular artifacts before rendering, and provide review surfaces for structures, molecule collections, trajectories, and molecular reports.",
  },
);

registerMolecularWorkspace(server);
registerMoleculeTable(server);
registerTrajectoryReview(server);
registerMolecularReport(server);

const transport = new StdioServerTransport();
await server.connect(transport);
