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
      prefersBorder: true,
      domain: appOrigin,
      csp: {
        connectDomains: [] as string[],
        resourceDomains: [appOrigin],
      },
    },
    "openai/widgetDescription":
      "Interactive 3D molecular structure preview with bounded composition counts.",
    "openai/widgetPrefersBorder": true,
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
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body { margin: 0; color: #eaf0f5; background: #0a0e14; }
      .shell { overflow: hidden; border: 1px solid rgba(135, 153, 178, .24); border-radius: 16px; background: #0d121a; }
      .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px 14px; border-bottom: 1px solid rgba(135, 153, 178, .18); }
      .title { min-width: 0; }
      .eyebrow { margin-bottom: 4px; color: #65d3c0; font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      h1 { overflow: hidden; margin: 0; font-size: 17px; font-weight: 650; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
      .summary { margin: 5px 0 0; color: #9aa7b7; font-size: 12px; line-height: 1.45; }
      .actions { display: flex; gap: 8px; }
      button { min-height: 34px; padding: 0 12px; border: 1px solid rgba(135, 153, 178, .25); border-radius: 10px; color: #dce5ee; background: rgba(255, 255, 255, .055); font: inherit; font-size: 12px; cursor: pointer; }
      button:hover { background: rgba(255, 255, 255, .1); }
      button[hidden] { display: none; }
      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: rgba(135, 153, 178, .14); }
      .metric { min-width: 0; padding: 11px 14px; background: #10161f; }
      .metric-label { color: #7e8b9b; font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
      .metric-value { overflow: hidden; margin-top: 4px; color: #eef3f8; font-size: 13px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
      .viewer-wrap { position: relative; height: min(58vh, 470px); min-height: 340px; background: #070a0e; }
      #viewer { position: absolute; inset: 0; }
      .status { position: absolute; z-index: 5; inset: 0; display: grid; place-items: center; padding: 28px; color: #91a0b1; background: #0a0e14; font-size: 13px; text-align: center; }
      .status.error { color: #ffb4ad; }
      .status[hidden] { display: none; }
      body[data-display-mode="fullscreen"] { height: 100dvh; overflow: hidden; }
      body[data-display-mode="fullscreen"] .shell { display: flex; height: 100%; flex-direction: column; border: 0; border-radius: 0; }
      body[data-display-mode="fullscreen"] .header,
      body[data-display-mode="fullscreen"] .metrics { flex: 0 0 auto; }
      body[data-display-mode="fullscreen"] .viewer-wrap { height: auto; min-height: 0; flex: 1 1 auto; }
      @media (max-width: 600px) {
        .header { align-items: stretch; flex-direction: column; }
        .actions { justify-content: flex-end; }
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .viewer-wrap { height: 390px; min-height: 300px; }
      }
      @media (prefers-color-scheme: light) {
        body { color: #18202a; background: #f6f8fa; }
        .shell { border-color: #d8dee6; background: #fff; }
        .header { border-color: #e3e7ec; }
        h1, .metric-value { color: #1c2530; }
        .summary { color: #697585; }
        button { border-color: #d5dce4; color: #334152; background: #f5f7f9; }
        button:hover { background: #eef2f5; }
        .metrics { background: #dde3e9; }
        .metric { background: #f8fafb; }
        .viewer-wrap, .status { background: #eef1f4; }
        .status { color: #647283; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="header">
        <div class="title">
          <div class="eyebrow">Burrete molecular viewer</div>
          <h1 id="title">Waiting for a structure…</h1>
          <p class="summary" id="summary">The model will pass a bounded molecular structure result to this viewer.</p>
        </div>
        <div class="actions">
          <button id="reset" type="button" disabled>Reset view</button>
          <button id="fullscreen" type="button" aria-pressed="false">Open full viewer</button>
        </div>
      </header>
      <section class="metrics" id="metrics" aria-label="Structure summary"></section>
      <section class="viewer-wrap" aria-label="Interactive three-dimensional molecular structure">
        <div id="viewer"></div>
        <div class="status" id="status">Waiting for the tool result…</div>
      </section>
    </main>
    <script src="${molstarScript}"></script>
    <script>
      (() => {
        const title = document.getElementById("title");
        const summary = document.getElementById("summary");
        const metrics = document.getElementById("metrics");
        const status = document.getElementById("status");
        const reset = document.getElementById("reset");
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

        function renderMetrics(data) {
          const rows = Array.isArray(data?.rows) ? data.rows.slice(0, 8) : [];
          metrics.replaceChildren();
          for (const row of rows) {
            const item = document.createElement("div");
            item.className = "metric";
            const label = document.createElement("div");
            label.className = "metric-label";
            label.textContent = String(row?.label || "Metric");
            const value = document.createElement("div");
            value.className = "metric-value";
            value.textContent = String(row?.value || "—");
            item.append(label, value);
            metrics.append(item);
          }
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
            layoutIsExpanded: false,
            layoutShowControls: true,
            layoutShowRemoteState: false,
            layoutShowSequence: true,
            layoutShowLog: false,
            layoutShowLeftPanel: true,
            collapseLeftPanel: true,
            collapseRightPanel: false,
            viewportShowExpand: false,
            viewportShowToggleFullscreen: false,
            viewportShowSettings: true,
            viewportShowSelectionMode: true,
            viewportShowAnimation: true,
            disabledExtensions: ["mp4-export"],
            pdbProvider: "rcsb",
            emdbProvider: "rcsb",
            preferWebgl1: true,
          };
          viewer = typeof window.molstar.Viewer.create === "function"
            ? await window.molstar.Viewer.create("viewer", options)
            : new window.molstar.Viewer("viewer", options);
          reset.disabled = false;
          return viewer;
        }

        async function renderToolResult(result) {
          const data = result?.structuredContent;
          const meta = resolveMeta(result);
          const structure = meta?.structure;
          if (!data || !structure?.data || !structure?.format) return;

          title.textContent = String(data.fileName || structure.label || "Molecular structure");
          summary.textContent = String(data.summaryLine || "Molecular structure preview");
          renderMetrics(data);

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

        reset.addEventListener("click", () => {
          viewer?.plugin?.managers?.camera?.reset?.();
        });
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
