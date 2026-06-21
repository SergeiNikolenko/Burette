import { readFileSync } from "node:fs";
import path from "node:path";

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";

import { pluginPath } from "./plugin-root.mjs";

export function readText(...parts) {
  return readFileSync(path.join(...parts), "utf8");
}

export function widgetHtml(assetDir) {
  const dir = pluginPath("mcp", "widget-assets", assetDir);
  const relativeHtmlPath = `mcp/widget-assets/${assetDir}/widget.html`;
  let html;
  try {
    html = readText(dir, "widget.html");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[Burrete MCP] Missing widget asset ${JSON.stringify(relativeHtmlPath)}. ` +
        "Reinstall or rebuild the Burrete plugin package so mcp/widget-assets is included. " +
        "Continuing with a diagnostic widget so MCP tools remain available. " +
        `Original error: ${detail}`,
    );
    html = diagnosticWidgetHtml(assetDir, relativeHtmlPath, detail);
  }
  const css = readOptionalText(dir, "widget.css");
  const js = readOptionalText(dir, "widget.js");
  return html
    .replace("/* __BURETTE_AGENT_WIDGET_CSS__ */", css)
    .replace("/* __BURETTE_AGENT_WIDGET_JS__ */", js);
}

export function registerWidgetResource(server, {
  name,
  uri,
  title,
  description,
  html,
  prefersBorder = true,
  resourceDomains = ["data:", "blob:"],
  connectDomains = [],
}) {
  const metadata = {
    ui: {
      prefersBorder,
      csp: {
        connectDomains,
        resourceDomains,
      },
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": prefersBorder,
    "openai/widgetCSP": {
      connect_domains: connectDomains,
      resource_domains: resourceDomains,
    },
  };

  registerAppResource(
    server,
    name,
    uri,
    {
      title,
      description,
      _meta: metadata,
    },
    async () => ({
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: metadata,
        },
      ],
    }),
  );
}

export function toolText(message) {
  return [{ type: "text", text: message }];
}

function readOptionalText(dir, fileName) {
  try {
    return readText(dir, fileName);
  } catch {
    return "";
  }
}

function diagnosticWidgetHtml(assetDir, relativeHtmlPath, detail) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Burrete Widget Asset Missing</title>
  <style>
    body { margin: 0; font: 13px system-ui, sans-serif; color: #111827; background: #f9fafb; }
    main { padding: 16px; }
    code { word-break: break-all; }
  </style>
  <style>/* __BURETTE_AGENT_WIDGET_CSS__ */</style>
</head>
<body>
  <main data-widget=${JSON.stringify(assetDir)} data-diagnostic="missing-widget-asset">
    <h1>Burrete widget asset missing</h1>
    <p>The MCP server is running, but the installed plugin package is missing this widget asset:</p>
    <p><code>${escapeHtml(relativeHtmlPath)}</code></p>
    <p>Reinstall or rebuild the Burrete plugin package so <code>mcp/widget-assets</code> is included.</p>
    <p><small>${escapeHtml(detail)}</small></p>
  </main>
  <script>/* __BURETTE_AGENT_WIDGET_JS__ */</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
