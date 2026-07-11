export const VIEWER_RESOURCE_URI = "ui://burrete/molecular-viewer-v2.html";
export const VIEWER_SHELL_SCRIPT_PATH =
  "/viewer-shell/assets/burrete-hosted-shell.js";
export const VIEWER_SHELL_STYLES_PATH =
  "/viewer-shell/assets/burrete-hosted-shell.css";
export const VIEWER_RUNTIME_ASSETS_PATH = "/burrete-viewer/";

export type ViewerWidgetOptions = {
  demoStructure?: {
    format: string;
    label: string;
    url: string;
  };
  fullPage?: boolean;
};

function assetUrl(origin: string, assetPath: string): string {
  if (!origin) return assetPath;
  return new URL(assetPath, `${origin.replace(/\/$/u, "")}/`).toString();
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function createViewerResourceMeta(appOrigin: string) {
  return {
    ui: {
      domain: appOrigin,
      prefersBorder: false,
      csp: {
        connectDomains: [appOrigin],
        resourceDomains: [appOrigin],
        frameDomains: [appOrigin],
      },
    },
    "openai/widgetDescription":
      "Full Burrete molecular workspace with the native viewer toolbar and molecular inspector.",
    "openai/widgetPrefersBorder": false,
    "openai/widgetCSP": {
      connect_domains: [appOrigin],
      resource_domains: [appOrigin],
      frame_domains: [appOrigin],
    },
    "openai/widgetDomain": appOrigin,
  } as const;
}

export function createViewerWidgetHtml(
  assetOrigin = "",
  options: ViewerWidgetOptions = {},
): string {
  const shellScript = assetUrl(assetOrigin, VIEWER_SHELL_SCRIPT_PATH);
  const shellStyles = assetUrl(assetOrigin, VIEWER_SHELL_STYLES_PATH);
  const viewerAssets = assetUrl(assetOrigin, VIEWER_RUNTIME_ASSETS_PATH);
  const bootstrap = serializeForInlineScript({
    demoStructure: options.demoStructure ? {
      ...options.demoStructure,
      url: assetUrl(assetOrigin, options.demoStructure.url),
    } : null,
    viewerAssets,
  });
  const documentSizing = options.fullPage
    ? "html, body, #root { width: 100%; min-height: 100%; height: 100%; }"
    : "html, body, #root { width: 100%; min-height: 480px; height: min(80vh, 760px); }";
  const compactSizing = options.fullPage
    ? ""
    : `@media (max-width: 600px) {
        html, body, #root { min-height: 420px; height: min(76vh, 680px); }
      }`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Burrete</title>
    <link rel="stylesheet" crossorigin href="${shellStyles}" />
    <style>
      ${documentSizing}
      body .app-shell { width: 100%; height: 100%; }
      body { margin: 0; overflow: hidden; background: #f7f7f7; }
      @media (prefers-color-scheme: dark) { body { background: #111315; } }
      ${compactSizing}
    </style>
    <script>
      (() => {
        const config = ${bootstrap};
        window.__BURRETE_HOSTED_MCP_WIDGET__ = true;
        window.__BURRETE_WEB_ASSETS_BASE__ = config.viewerAssets;
        window.__BURRETE_HOSTED_MCP_RESULTS__ = [];
        const deliverToolResult = (result) => {
          if (window.__BURRETE_HOSTED_MCP_BRIDGE_READY__) {
            window.postMessage({
              source: "burrete-hosted-mcp-widget",
              type: "tool-result",
              result,
            }, "*");
            return;
          }
          window.__BURRETE_HOSTED_MCP_RESULTS__.push(result);
        };
        const loadDemoStructure = async () => {
          const response = await fetch(config.demoStructure.url, {
            credentials: "same-origin",
          });
          if (!response.ok) {
            throw new Error(
              "Demo structure request failed with HTTP " + response.status,
            );
          }
          const data = await response.text();
          deliverToolResult({
            structuredContent: { fileName: config.demoStructure.label },
            _meta: {
              structure: {
                data,
                format: config.demoStructure.format,
                label: config.demoStructure.label,
              },
            },
          });
        };
        window.addEventListener("message", (event) => {
          if (event.source !== window.parent) return;
          const message = event.data;
          if (message?.jsonrpc !== "2.0") return;
          if (
            message.method === "ui/notifications/tool-result"
            && !window.__BURRETE_HOSTED_MCP_BRIDGE_READY__
          ) {
            window.__BURRETE_HOSTED_MCP_RESULTS__.push(message.params);
          }
        }, { passive: true });
        window.addEventListener("openai:set_globals", (event) => {
          const globals = event.detail?.globals;
          if (
            !globals?.toolOutput
            || window.__BURRETE_HOSTED_MCP_BRIDGE_READY__
          ) return;
          window.__BURRETE_HOSTED_MCP_RESULTS__.push({
            structuredContent: globals.toolOutput,
            _meta: globals.toolResponseMetadata,
          });
        }, { passive: true });
        if (config.demoStructure) {
          void loadDemoStructure().catch((error) => {
            console.error("Failed to load the Burrete demo structure", error);
          });
        }
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" crossorigin src="${shellScript}"></script>
  </body>
</html>`;
}
