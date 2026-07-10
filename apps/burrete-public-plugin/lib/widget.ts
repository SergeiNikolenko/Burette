export const VIEWER_RESOURCE_URI = "ui://burrete/molecular-viewer-v1.html";
export const MOLSTAR_SCRIPT_PATH = "/molstar/molstar.js";
export const MOLSTAR_STYLES_PATH = "/molstar/molstar.css";

function assetUrl(origin: string, assetPath: string): string {
  if (!origin) return assetPath;
  return new URL(assetPath, `${origin.replace(/\/$/u, "")}/`).toString();
}

export function createViewerResourceMeta(appOrigin: string) {
  return {
    ui: {
      prefersBorder: false,
      domain: appOrigin,
      csp: {
        connectDomains: [] as string[],
        resourceDomains: [appOrigin],
      },
    },
    "openai/widgetDescription": "Full interactive Burrete molecular structure viewer.",
    "openai/widgetPrefersBorder": false,
    "openai/widgetCSP": {
      connect_domains: [] as string[],
      resource_domains: [appOrigin],
    },
    "openai/widgetDomain": appOrigin,
  } as const;
}

export function createViewerWidgetHtml(assetOrigin = ""): string {
  const molstarScript = assetUrl(assetOrigin, MOLSTAR_SCRIPT_PATH);
  const molstarStyles = assetUrl(assetOrigin, MOLSTAR_STYLES_PATH);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Burrete Molecular Viewer</title>
    <link rel="stylesheet" href="${molstarStyles}" />
    <style>
      :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; min-height: 0; }
      body { margin: 0; overflow: hidden; color: #f2f2f2; background: #000; }
      .shell { position: relative; width: 100%; height: min(76vh, 720px); min-height: 420px; overflow: hidden; background: #000; }
      .viewer-wrap, #viewer { position: absolute; inset: 0; }
      .fullscreen { position: absolute; z-index: 1001; top: 12px; right: 12px; min-height: 34px; padding: 0 12px; border: 1px solid rgba(255, 255, 255, .16); border-radius: 9px; color: rgba(255, 255, 255, .94); background: rgba(12, 13, 14, .9); box-shadow: 0 8px 24px rgba(0, 0, 0, .28); font: inherit; font-size: 12px; cursor: pointer; backdrop-filter: blur(12px); }
      .fullscreen:hover { background: rgba(38, 40, 44, .96); }
      .fullscreen[hidden] { display: none; }
      .status { position: absolute; z-index: 1002; inset: 0; display: grid; place-items: center; padding: 28px; color: #aeb7c2; background: #000; font-size: 13px; text-align: center; }
      .status.error { color: #ffb4ad; }
      .status[hidden] { display: none; }
      body[data-display-mode="fullscreen"] .shell { position: fixed; inset: 0; height: 100dvh; min-height: 0; }
      body[data-display-mode="fullscreen"] .fullscreen { display: none; }
      @media (max-width: 600px) {
        .shell { height: min(72vh, 620px); min-height: 360px; }
        .fullscreen { top: 8px; right: 8px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="viewer-wrap" aria-label="Interactive three-dimensional molecular structure">
        <div id="viewer"></div>
        <div class="status" id="status">Waiting for the tool result…</div>
      </section>
      <button class="fullscreen" id="fullscreen" type="button" aria-pressed="false">Open full viewer</button>
    </main>
    <script src="${molstarScript}"></script>
    <script>
      (() => {
        const status = document.getElementById("status");
        const fullscreen = document.getElementById("fullscreen");
        let viewer = null;
        let renderedKey = "";

        function applyDisplayMode(mode) {
          const normalized = mode === "fullscreen" ? "fullscreen" : "inline";
          document.body.dataset.displayMode = normalized;
          fullscreen.textContent = normalized === "fullscreen"
            ? "Exit full viewer"
            : "Open full viewer";
          fullscreen.setAttribute("aria-pressed", String(normalized === "fullscreen"));
          requestAnimationFrame(() => {
            window.dispatchEvent(new Event("resize"));
          });
        }

        function syncBridgeControls() {
          fullscreen.hidden = typeof window.openai?.requestDisplayMode !== "function";
        }

        function resolveMeta(value) {
          if (!value || typeof value !== "object") return {};
          return value._meta
            || value.mcp_tool_result?._meta
            || value.mcp_tool_result?.result?._meta
            || value.call_tool_result?._meta
            || value.call_tool_result?.result?._meta
            || {};
        }

        function initialResult() {
          const bridge = window.openai;
          if (!bridge) return null;
          return {
            structuredContent: bridge.toolOutput || null,
            _meta: resolveMeta(bridge.toolResponseMetadata),
          };
        }

        function setStatus(message, isError = false) {
          status.textContent = message;
          status.classList.toggle("error", isError);
          status.hidden = false;
        }

        async function ensureViewer() {
          if (viewer) return viewer;
          if (!window.molstar?.Viewer) {
            throw new Error("Mol* did not load in this environment.");
          }
          const options = {
            layoutIsExpanded: true,
            layoutShowControls: true,
            layoutShowRemoteState: false,
            layoutShowSequence: true,
            layoutShowLog: false,
            layoutShowLeftPanel: true,
            viewportShowReset: true,
            viewportShowScreenshotControls: true,
            viewportShowControls: true,
            collapseLeftPanel: true,
            collapseRightPanel: true,
            viewportShowExpand: false,
            viewportShowToggleFullscreen: false,
            viewportShowSettings: true,
            viewportShowSelectionMode: true,
            viewportShowAnimation: true,
            disabledExtensions: ["mp4-export"],
            pdbProvider: "rcsb",
            emdbProvider: "rcsb",
            preferWebgl1: true,
            disableAntialiasing: true,
          };
          viewer = typeof window.molstar.Viewer.create === "function"
            ? await window.molstar.Viewer.create("viewer", options)
            : new window.molstar.Viewer("viewer", options);
          return viewer;
        }

        async function renderToolResult(result) {
          const data = result?.structuredContent;
          const meta = resolveMeta(result);
          const structure = meta?.structure;
          if (!data || !structure?.data || !structure?.format) return;

          const key = [structure.label, structure.format, structure.data.length].join(":");
          if (key === renderedKey) return;
          renderedKey = key;
          setStatus("Preparing the interactive 3D structure…");
          try {
            const activeViewer = await ensureViewer();
            await activeViewer.loadStructureFromData(
              structure.data,
              structure.format,
              { dataLabel: structure.label || data.fileName || "Structure" },
            );
            status.hidden = true;
          } catch (error) {
            setStatus(
              "The structure summary is available, but the 3D viewer could not load this file.",
              true,
            );
          }
        }

        fullscreen.addEventListener("click", async () => {
          const targetMode = document.body.dataset.displayMode === "fullscreen"
            ? "inline"
            : "fullscreen";
          const result = await window.openai?.requestDisplayMode?.({ mode: targetMode });
          applyDisplayMode(result?.mode || window.openai?.displayMode || targetMode);
        });
        syncBridgeControls();
        applyDisplayMode(window.openai?.displayMode);

        window.addEventListener("message", (event) => {
          if (event.source !== window.parent) return;
          const message = event.data;
          if (message?.jsonrpc !== "2.0") return;
          if (message.method === "ui/notifications/tool-result") {
            void renderToolResult(message.params);
          }
        }, { passive: true });

        window.addEventListener("openai:set_globals", (event) => {
          const globals = event.detail?.globals;
          if (!globals) return;
          syncBridgeControls();
          if (globals.displayMode) applyDisplayMode(globals.displayMode);
          if (globals.toolOutput) {
            void renderToolResult({
              structuredContent: globals.toolOutput,
              _meta: resolveMeta(globals.toolResponseMetadata),
            });
          }
        }, { passive: true });

        void renderToolResult(initialResult());
      })();
    </script>
  </body>
</html>`;
}

interface StandaloneViewerResult {
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function createStandaloneViewerHtml(
  result: StandaloneViewerResult,
  assetOrigin = "",
): string {
  const payload = serializeForInlineScript(result);
  const molstarScript = assetUrl(assetOrigin, MOLSTAR_SCRIPT_PATH);
  const bridge = `<script>
      (() => {
        const initialResult = ${payload};
        window.openai = {
          toolOutput: initialResult.structuredContent,
          toolResponseMetadata: { _meta: initialResult._meta },
          displayMode: "fullscreen",
        };
      })();
    </script>`;

  return createViewerWidgetHtml(assetOrigin).replace(
    `    <script src="${molstarScript}"></script>`,
    `    ${bridge}\n    <script src="${molstarScript}"></script>`,
  );
}
