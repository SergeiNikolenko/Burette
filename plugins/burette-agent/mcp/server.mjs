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
import { registerMolecularBackground } from "./registrations/molecular-background/register.mjs";
import { registerMentions } from "./registrations/mentions/register.mjs";
import { addToolIcons, buretteIcons } from "./lib/tool-icons.mjs";

const pluginManifest = JSON.parse(readFileSync(pluginPath(".codex-plugin", "plugin.json"), "utf8"));

const server = new McpServer(
  {
    name: pluginManifest.name,
    version: pluginManifest.version,
    icons: buretteIcons,
  },
  {
    instructions:
      "Operate Burette molecular workspaces through tools. For contacts, SASA, TM-align and PNG export use open_molecular_session/run_molecular_operation/molecular_job: these run without a mounted panel or an open chat. Keep the sessionId and poll each job to completion. For live scene controls or Ketcher reuse this task's mounted sessionId and await acknowledgement; awaiting_mount blocks only live controls. Requests to operate molecules are not requests to edit Burette source code. Skills own detailed workflow routing. Tool catalogs are context, not a request to install plugins.",
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
registerMolecularBackground(server);
registerMentions(server);
addToolIcons(server, ["burette.open_app", "burette.open_tab", "burette.open_file", "burette.mentions"]);

const transport = new StdioServerTransport();
await server.connect(transport);
