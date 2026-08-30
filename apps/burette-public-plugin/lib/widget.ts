// This URI is a persisted ChatGPT connector contract. Keep it stable across
// asset-only deployments; changing it requires refreshing every connector.
export const VIEWER_RESOURCE_URI = "ui://burette/molecular-viewer-v21.html";
export const KETCHER_RESOURCE_URI = "ui://burette/ketcher-editor-v1.html";
export const VIEWER_SHELL_SCRIPT_PATH =
  "/viewer-shell/assets/burette-hosted-shell.js";
export const VIEWER_SHELL_STYLES_PATH =
  "/viewer-shell/assets/burette-hosted-shell.css";
export const VIEWER_RUNTIME_ASSETS_PATH = "/burette-viewer/";
export const VIEWER_MOBILE_SCRIPT_PATH = "/burette-hosted-mobile.js";
export const VIEWER_APP_BRIDGE_SCRIPT_PATH = "/burette-hosted-app.js";
const VIEWER_SHELL_ASSET_VERSION = "viewer-v23";

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
      },
    },
    "openai/widgetDescription":
      "Focused Burette molecular preview with the native interactive viewer controls.",
    "openai/widgetPrefersBorder": false,
    "openai/widgetCSP": {
      connect_domains: [appOrigin],
      resource_domains: [appOrigin],
    },
    "openai/widgetDomain": appOrigin,
  } as const;
}

export function createKetcherResourceMeta(appOrigin: string) {
  return {
    ...createViewerResourceMeta(appOrigin),
    "openai/widgetDescription":
      "Focused Burette Ketcher chemical editor with a revision-checked agent bridge.",
  } as const;
}

export function createKetcherWidgetHtml(assetOrigin = ""): string {
  return createWidgetHtml(assetOrigin, true);
}

export function createViewerWidgetHtml(assetOrigin = ""): string {
  return createWidgetHtml(assetOrigin, false);
}

function createWidgetHtml(assetOrigin: string, ketcherWidget: boolean): string {
  const shellScript = `${assetUrl(assetOrigin, VIEWER_SHELL_SCRIPT_PATH)}?v=${VIEWER_SHELL_ASSET_VERSION}`;
  const shellStyles = `${assetUrl(assetOrigin, VIEWER_SHELL_STYLES_PATH)}?v=${VIEWER_SHELL_ASSET_VERSION}`;
  const viewerAssets = assetUrl(assetOrigin, VIEWER_RUNTIME_ASSETS_PATH);
  const mobileScript = `${assetUrl(assetOrigin, VIEWER_MOBILE_SCRIPT_PATH)}?v=${VIEWER_SHELL_ASSET_VERSION}`;
  const appBridgeScript = `${assetUrl(assetOrigin, VIEWER_APP_BRIDGE_SCRIPT_PATH)}?v=${VIEWER_SHELL_ASSET_VERSION}`;
  const bootstrap = serializeForInlineScript({
    viewerAssets,
    analyticsOrigin: assetOrigin.replace(/\/$/u, ""),
    ketcherWidget,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Burette</title>
    <link rel="stylesheet" crossorigin href="${shellStyles}" />
    <style>
      html, body, #root { width: 100%; min-height: 480px; height: min(80vh, 760px); }
      body .app-shell { width: 100%; height: 100%; }
      body { margin: 0; overflow: hidden; background: #f7f7f7; }
      @media (prefers-color-scheme: dark) { body { background: #000000; } }
      @media (max-width: 600px) {
        html, body, #root, #app { min-height: 0; height: 100%; }
      }
    </style>
    <script>
      (() => {
        const config = ${bootstrap};
        window.__BURETTE_HOSTED_MCP_WIDGET__ = true;
        window.__BURETTE_HOSTED_KETCHER_WIDGET__ = config.ketcherWidget === true;
        window.__BURETTE_HOSTED_KETCHER_RESULTS__ = [];
        window.__BURETTE_WEB_ASSETS_BASE__ = config.viewerAssets;
        window.__BURETTE_HOSTED_ANALYTICS_ORIGIN__ = config.analyticsOrigin;
        window.__BURETTE_HOSTED_MCP_RESULTS__ = [];
        window.__BURETTE_HOSTED_OPENAI_GLOBALS__ = {};
        const appQueue = [];
        const appReady = new Promise((resolve) => { window.__BURETTE_HOSTED_APP_READY__ = resolve; });
        window.__BURETTE_HOSTED_APP_QUEUE__ = appQueue;
        const callServerTool = (name, arguments_) => appReady.then((ready) => {
          if (!ready) throw new Error("Burette Apps bridge is not ready for server tool calls.");
          const bridge = window.BuretteHostedAppBridge;
          if (!bridge?.callServerTool) throw new Error("Burette Apps bridge does not expose server tool calls.");
          return bridge.callServerTool(name, arguments_);
        });
        const downloadTextFile = (fileName, text, mimeType) => appReady.then((ready) => {
          if (!ready) throw new Error("Burette Apps bridge is not ready for file downloads.");
          const bridge = window.BuretteHostedAppBridge;
          if (!bridge?.downloadTextFile) throw new Error("Burette Apps bridge does not expose file downloads.");
          return bridge.downloadTextFile(fileName, text, mimeType);
        });
        const acceptKetcherResult = (value) => {
          if (!window.__BURETTE_HOSTED_KETCHER_WIDGET__) return;
          const containers = [value, value?._meta, value?.meta, value?.structuredContent, value?.structuredContent?._meta];
          const stateSource = containers.find((candidate) => candidate && typeof candidate === "object" && Object.hasOwn(candidate, "ketcherState"));
          const state = stateSource?.ketcherState;
          if (
            !state
            || typeof state !== "object"
            || typeof state.surfaceId !== "string"
            || typeof state.continuationToken !== "string"
          ) return;
          const snapshotSource = containers.find((candidate) => candidate && typeof candidate === "object" && Object.hasOwn(candidate, "snapshot"));
          const ketcherSource = containers.find((candidate) => candidate && typeof candidate === "object" && Object.hasOwn(candidate, "ketcher"));
          const result = {
            state: {
              surfaceId: state.surfaceId,
              continuationToken: state.continuationToken,
              snapshot: snapshotSource?.snapshot ?? ketcherSource?.ketcher ?? null,
            },
          };
          const source = containers.find((candidate) => candidate && typeof candidate === "object" && Object.hasOwn(candidate, "ketcherSeed"));
          if (source) {
            const meta = source.ketcherSeed;
            if (meta == null) result.seed = null;
            else {
              if (typeof meta !== "object" || typeof meta.content !== "string") return;
              if (!["ket", "mol", "rxn", "smiles"].includes(meta.format)) return;
              if (typeof meta.surfaceId === "string" && meta.surfaceId !== state.surfaceId) return;
              let content = meta.content.slice(0, 65536);
              while (new TextEncoder().encode(content).byteLength > 65536) content = content.slice(0, -1);
              result.seed = {
                surfaceId: typeof meta.surfaceId === "string" ? meta.surfaceId : undefined,
                format: meta.format,
                content,
              };
            }
          }
          window.__BURETTE_HOSTED_KETCHER_RESULTS__.push(result);
          if (window.__BURETTE_HOSTED_KETCHER_RESULTS__.length > 16) {
            window.__BURETTE_HOSTED_KETCHER_RESULTS__.splice(0, window.__BURETTE_HOSTED_KETCHER_RESULTS__.length - 16);
          }
          window.dispatchEvent(new CustomEvent("burette-ketcher-result", { detail: result }));
        };
        window.BuretteHostedAppBridge = {
          ready: appReady,
          setSource: (...args) => { appQueue.push({ method: "setSource", args }); },
          updateSelection: (...args) => {
            appQueue.push({ method: "updateSelection", args });
            return appReady;
          },
          updateScene: (...args) => {
            appQueue.push({ method: "updateScene", args });
            return appReady;
          },
          updateKetcher: (...args) => {
            appQueue.push({ method: "updateKetcher", args });
            return appReady;
          },
          callServerTool,
          downloadTextFile,
          sanitizeViewerActions: () => [],
        };
        window.addEventListener("message", (event) => {
          if (event.source !== window.parent) return;
          const message = event.data;
          if (message?.jsonrpc !== "2.0") return;
          if (message.method === "ui/notifications/tool-result") acceptKetcherResult(message.params);
          if (
            message.method === "ui/notifications/tool-result"
            && !window.__BURETTE_HOSTED_MCP_BRIDGE_READY__
          ) {
            window.__BURETTE_HOSTED_MCP_RESULTS__.push(message.params);
          }
        }, { passive: true });
        window.addEventListener("openai:set_globals", (event) => {
          const globals = event.detail?.globals;
          if (!globals || window.__BURETTE_HOSTED_MCP_BRIDGE_READY__) return;
          if (Object.hasOwn(globals, "toolOutput")) {
            window.__BURETTE_HOSTED_OPENAI_GLOBALS__.toolOutput = globals.toolOutput;
          }
          if (Object.hasOwn(globals, "toolResponseMetadata")) {
            window.__BURETTE_HOSTED_OPENAI_GLOBALS__.toolResponseMetadata = globals.toolResponseMetadata;
          }
          acceptKetcherResult({
            structuredContent: window.__BURETTE_HOSTED_OPENAI_GLOBALS__.toolOutput,
            _meta: window.__BURETTE_HOSTED_OPENAI_GLOBALS__.toolResponseMetadata,
          });
          window.__BURETTE_HOSTED_MCP_RESULTS__.push({
            structuredContent: window.__BURETTE_HOSTED_OPENAI_GLOBALS__.toolOutput,
            _meta: window.__BURETTE_HOSTED_OPENAI_GLOBALS__.toolResponseMetadata,
          });
        }, { passive: true });
      })();
    </script>
    <script type="module" crossorigin src="${appBridgeScript}"></script>
  </head>
  <body>
    <div id="root"></div>
    <script>
      (() => {
        const mobile = window.matchMedia("(max-width: 600px)").matches
          || /iPhone|iPad|iPod/iu.test(navigator.userAgent);
        const script = document.createElement("script");
        script.src = mobile && !window.__BURETTE_HOSTED_KETCHER_WIDGET__ ? ${serializeForInlineScript(mobileScript)} : ${serializeForInlineScript(shellScript)};
        if (!mobile || window.__BURETTE_HOSTED_KETCHER_WIDGET__) script.type = "module";
        script.crossOrigin = "anonymous";
        const timeout = window.setTimeout(() => {
          const root = document.getElementById("root");
          if (root) root.textContent = "Burette viewer failed to load.";
        }, 15000);
        script.addEventListener("load", () => window.clearTimeout(timeout), { once: true });
        script.addEventListener("error", () => {
          window.clearTimeout(timeout);
          const root = document.getElementById("root");
          if (root) root.textContent = "Burette viewer failed to load.";
        }, { once: true });
        document.body.appendChild(script);
      })();
    </script>
  </body>
</html>`;
}
