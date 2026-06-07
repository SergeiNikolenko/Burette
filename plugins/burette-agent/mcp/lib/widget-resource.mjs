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
  const html = readText(dir, "widget.html");
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
