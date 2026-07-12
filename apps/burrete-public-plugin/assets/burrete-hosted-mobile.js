(() => {
  "use strict";

  const MAX_STRUCTURE_BYTES = 3 * 1024 * 1024;
  const MAX_SELECTION_RESIDUES = 96;
  const SUPPORTED_FORMATS = new Set(["pdb", "mmcif", "sdf", "xyz"]);
  const assetsBase = String(window.__BURRETE_WEB_ASSETS_BASE__ || "/burrete-viewer/").replace(/\/$/u, "");
  let started = false;
  let selectionRequestId = 0;

  const record = (value) => value && typeof value === "object" ? value : null;
  const bounded = (value, fallback = "") => {
    const text = typeof value === "string" ? value.trim() : "";
    return (text || fallback).slice(0, 255);
  };
  const normalizedFormat = (value) => {
    const format = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (format === "cif" || format === "mcif") return "mmcif";
    if (format === "sd") return "sdf";
    return SUPPORTED_FORMATS.has(format) ? format : null;
  };
  const nestedMetadata = (value) => {
    const envelope = record(value);
    const result = record(envelope?.result);
    return record(result?._meta) || record(envelope?._meta);
  };
  const resultMetadata = (result) => {
    const metadata = record(result?._meta) || record(result?.meta);
    return record(metadata?._meta)
      || nestedMetadata(metadata?.mcp_tool_result)
      || nestedMetadata(metadata?.call_tool_result)
      || metadata;
  };
  const structureFromResult = (value) => {
    const result = record(value);
    const structure = record(resultMetadata(result)?.structure);
    const data = typeof structure?.data === "string" ? structure.data : "";
    const format = normalizedFormat(structure?.format);
    const byteCount = new TextEncoder().encode(data).length;
    if (!data || !format || byteCount > MAX_STRUCTURE_BYTES) return null;
    return {
      data,
      format,
      byteCount,
      label: bounded(structure?.label, bounded(record(result?.structuredContent)?.fileName, "Molecular structure")),
    };
  };
  const base64Utf8 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  };
  const addStylesheet = (name) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.crossOrigin = "anonymous";
    link.href = `${assetsBase}/${name}`;
    document.head.appendChild(link);
  };
  const loadScript = (name) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.crossOrigin = "anonymous";
    script.src = `${assetsBase}/${name}`;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${name}`)), { once: true });
    document.body.appendChild(script);
  });
  const jsonElement = (id, value) => {
    const element = document.createElement("script");
    element.id = id;
    element.type = "application/json";
    element.textContent = JSON.stringify(value).replaceAll("<", "\\u003c");
    document.head.appendChild(element);
  };

  function updateSelectionContext(body) {
    const selection = record(body?.selection);
    if (body?.type !== "selectionChanged" || selection?.source !== "lasso") return;
    const residues = Array.isArray(selection.residues)
      ? selection.residues.slice(0, MAX_SELECTION_RESIDUES).map((value) => {
        const residue = record(value) || {};
        return {
          chain: bounded(residue.chain),
          compId: bounded(residue.compId),
          sequence: typeof residue.sequence === "number" || typeof residue.sequence === "string"
            ? residue.sequence
            : null,
        };
      })
      : [];
    const atoms = Math.max(0, Math.trunc(Number(selection.atoms) || 0));
    const label = bounded(selection.label, `Lasso selection with ${atoms} visible atoms across ${residues.length} residues`);
    selectionRequestId += 1;
    window.parent.postMessage({
      jsonrpc: "2.0",
      id: `burrete-selection-context-${selectionRequestId}`,
      method: "ui/update-model-context",
      params: {
        content: [{
          type: "text",
          text: `Current Burrete selection: ${label}. Treat this as the user's active molecular selection for their next request.`,
        }],
        structuredContent: {
          burrete: {
            activeSelection: {
              source: "lasso",
              documentId: bounded(body.documentId, "active-structure"),
              label,
              atoms,
              residues,
            },
          },
        },
      },
    }, "*");
  }

  async function start(structure) {
    if (started) return;
    started = true;
    const root = document.getElementById("root");
    if (!root) throw new Error("Hosted viewer root is unavailable");
    root.id = "app";
    root.insertAdjacentHTML("afterend", '<div id="status" class="hidden">Loading structure...</div>');
    document.body.className = "burette-opaque-background";
    document.documentElement.classList.add("buret-hosted-mobile-direct");

    addStylesheet("viewer-runtime.css");
    addStylesheet("molstar.css");
    const documentId = `hosted-${Date.now()}`;
    jsonElement("burrete-runtime-config", {
      format: structure.format,
      molstarFormat: structure.format,
      binary: false,
      renderer: "molstar",
      requestedRenderer: "molstar",
      allowMolstarFallback: false,
      label: structure.label,
      byteCount: structure.byteCount,
      previewByteCount: structure.byteCount,
      quickLookBuild: "burrete-hosted-mobile-direct",
      debug: false,
      theme: "auto",
      canvasBackground: "black",
      documentId,
      uiScale: 0.9,
      overlayOpacity: 0.9,
      transparentBackground: false,
      appViewer: true,
      tauriViewer: false,
      molstarStyle: "illustrative",
      molstarPreferWebgl1: false,
      molstarDisableAntialiasing: false,
      molstarPixelScale: 1,
      molstarPickScale: 1,
      molstarResolutionMode: "native",
      molstarPowerPreference: "default",
      waterRepresentation: "line",
      xyzrenderViewer: false,
      xyzrenderAvailable: false,
      molstarAvailable: true,
      showPanelControls: true,
      defaultLayoutState: { left: "hidden", right: "hidden", top: "hidden", bottom: "hidden" },
    });
    jsonElement("burrete-runtime-data", base64Utf8(structure.data));

    await loadScript("viewer-shell.js");
    await loadScript("viewer-bootstrap.js");
    window.__mqlPost = (type, message, payload = {}) => {
      updateSelectionContext({ type, message, ...payload, documentId });
    };
    await loadScript("molstar.js");
    await loadScript("burette-agent.js");
    await loadScript("trajectory-smoothing.js");
    await loadScript("viewer.js");
  }

  function acceptResult(value) {
    if (started) return;
    const structure = structureFromResult(value);
    if (!structure) return;
    start(structure).catch((error) => {
      const status = document.getElementById("status");
      if (status) {
        status.className = "error";
        status.textContent = `[web] Burrete mobile renderer failed to start.\n\n${error?.message || String(error)}`;
      }
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = record(event.data);
    if (message?.jsonrpc === "2.0" && message.method === "ui/notifications/tool-result") {
      acceptResult(message.params);
    }
  }, { passive: true });
  window.addEventListener("openai:set_globals", (event) => {
    const globals = event.detail?.globals;
    if (globals?.toolOutput === undefined) return;
    acceptResult({ structuredContent: globals.toolOutput, _meta: globals.toolResponseMetadata });
  }, { passive: true });

  const queued = Array.isArray(window.__BURRETE_HOSTED_MCP_RESULTS__)
    ? window.__BURRETE_HOSTED_MCP_RESULTS__
    : [];
  if (queued.length > 0) acceptResult(queued[queued.length - 1]);
  if (!started && window.openai?.toolOutput !== undefined) {
    acceptResult({
      structuredContent: window.openai.toolOutput,
      _meta: window.openai.toolResponseMetadata,
    });
  }
})();
