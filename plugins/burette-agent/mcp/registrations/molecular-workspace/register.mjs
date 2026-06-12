import { readFileSync } from "node:fs";

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { runBurreteAgent } from "../../lib/cli-bridge.mjs";
import { pluginPath } from "../../lib/plugin-root.mjs";
import { registerWidgetResource, toolText, widgetHtml } from "../../lib/widget-resource.mjs";

const WIDGET_URI = "ui://widget/burette-agent/molecular-workspace-20260607.html";
const actionSchema = z.object({ type: z.string().trim().min(1) }).passthrough();

export function registerMolecularWorkspace(server) {
  registerWidgetResource(server, {
    name: "burette-molecular-workspace-widget",
    uri: WIDGET_URI,
    title: "Burrete Molecular Workspace",
    description: "A compact review surface for Burrete observe payloads, active documents, viewer status, panels, and recent actions.",
    html: injectInitialData(widgetHtml("molecular-workspace")),
  });

  registerAppTool(
    server,
    "open_burrete_workspace",
    {
      title: "Open Burrete Workspace",
      description: "Open a local molecular artifact in the full Browser shell, Browser preview, or the real Burrete desktop app through the repository CLI.",
      inputSchema: {
        file: z.string().trim(),
        mode: z.enum(["browser-dev-shell", "browser-preview", "desktop-app"]).default("browser-dev-shell"),
        app: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        host: z.string().trim().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        noLaunch: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const args = ["open", "--mode", input.mode];
      if (input.app) args.push("--app", input.app);
      if (input.sessionDir) args.push("--session-dir", input.sessionDir);
      if (input.host) args.push("--host", input.host);
      if (input.port) args.push("--port", String(input.port));
      if (input.noLaunch) args.push("--no-launch");
      args.push(input.file);
      const result = await runBurreteAgent(args, { timeoutMs: 45000 });
      return cliToolResult("open_burrete_workspace", result);
    },
  );

  registerAppTool(
    server,
    "observe_burrete_workspace",
    {
      title: "Observe Burrete Workspace",
      description: "Read structured Burrete workspace state from a tokenized Browser preview URL or desktop session directory.",
      inputSchema: {
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
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
      const args = ["observe"];
      if (input.url) args.push("--url", input.url);
      if (input.sessionDir) args.push("--session-dir", input.sessionDir);
      const result = await runBurreteAgent(args);
      const observe = result.payload?.result || null;
      return {
        content: toolText(result.ok ? "Observed Burrete workspace." : `Observe failed: ${result.error?.message || "unknown error"}`),
        structuredContent: {
          ok: result.ok,
          tool: "observe_burrete_workspace",
          observe,
          error: result.ok ? null : result.error,
        },
        _meta: {
          "openai/outputTemplate": WIDGET_URI,
          widgetData: {
            title: observe?.activeDocument?.title || "Burrete Workspace",
            observe,
          },
        },
      };
    },
  );

  registerAppTool(
    server,
    "act_molstar_scene",
    {
      title: "Act On Molstar Scene",
      description: "Queue an allowlisted high-level or declarative Mol* scene action through the Burrete agent contract.",
      inputSchema: {
        action: actionSchema,
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const args = ["act"];
      if (input.url) args.push("--url", input.url);
      if (input.sessionDir) args.push("--session-dir", input.sessionDir);
      args.push(JSON.stringify(input.action));
      if (input.waitMs) args.push("--wait-ms", String(input.waitMs));
      const result = await runBurreteAgent(args, { timeoutMs: Math.max(30000, (input.waitMs || 0) + 5000) });
      return cliToolResult("act_molstar_scene", result);
    },
  );

  registerAppTool(
    server,
    "render_molecular_workspace_widget",
    {
      title: "Render Molecular Workspace Widget",
      description: "Render a bounded Burrete observe payload as an inline molecular workspace review surface.",
      inputSchema: {
        title: z.string().trim().optional(),
        summary: z.string().trim().optional(),
        observe: z.record(z.unknown()),
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
      content: toolText("Rendered Burrete molecular workspace widget."),
      structuredContent: {
        version: 1,
        widget: "molecular-workspace",
        title: input.title || input.observe?.activeDocument?.title || "Molecular Workspace",
        ready: Boolean(input.observe?.activeDocument?.ready),
        mode: input.observe?.mode || null,
      },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        widgetData: input,
      },
    }),
  );
}

function cliToolResult(tool, result) {
  return {
    content: toolText(result.ok ? `${tool} completed.` : `${tool} failed: ${result.error?.message || "unknown error"}`),
    structuredContent: {
      ok: result.ok,
      tool,
      result: result.payload?.result || null,
      error: result.ok ? null : result.error,
      exitCode: result.exitCode,
    },
  };
}

function injectInitialData(html) {
  const manifestPath = pluginPath(".codex-plugin", "plugin.json");
  let version = "0.1.0";
  try {
    version = JSON.parse(readFileSync(manifestPath, "utf8")).version || version;
  } catch {
    // Static widget rendering does not depend on manifest availability.
  }
  return html.replace("</head>", `<script>window.__BURETTE_AGENT_PLUGIN_VERSION__=${JSON.stringify(version)};</script></head>`);
}
