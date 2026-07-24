(() => {
  "use strict";

  const MAX_STRUCTURE_BYTES = 3 * 1024 * 1024;
  const ASSET_LOAD_TIMEOUT_MS = 30_000;
  const BOOTSTRAP_TIMEOUT_MS = 15_000;
  const SUPPORTED_FORMATS = new Set(["pdb", "mmcif", "sdf", "xyz"]);
  const assetsBase = String(window.__BURETTE_WEB_ASSETS_BASE__ || "/burette-viewer/").replace(/\/$/u, "");
  let started = false;
  let latestToolOutput;
  let latestToolResponseMetadata;

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
    const metadata = resultMetadata(result);
    const structure = record(metadata?.structure);
    const scene = record(metadata?.scene);
    const data = typeof structure?.data === "string" ? structure.data : "";
    const format = normalizedFormat(structure?.format);
    const byteCount = new TextEncoder().encode(data).length;
    if (!data || !format || byteCount > MAX_STRUCTURE_BYTES) return null;
    return {
      data,
      format,
      byteCount,
      label: bounded(structure?.label, bounded(record(result?.structuredContent)?.fileName, "Molecular structure")),
      source: record(scene?.source),
      actions: Array.isArray(scene?.actions)
        ? scene.actions.slice(0, 8).map(record).filter(Boolean)
        : [],
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
  const waitForAsset = (element, name) => new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(`Timed out loading ${name}`)),
      ASSET_LOAD_TIMEOUT_MS,
    );
    element.addEventListener("load", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
    element.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error(`Failed to load ${name}`));
    }, { once: true });
  });
  const addStylesheet = (name) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.crossOrigin = "anonymous";
    link.href = `${assetsBase}/${name}`;
    const loaded = waitForAsset(link, name);
    document.head.appendChild(link);
    return loaded;
  };
  const loadScript = (name) => {
    const script = document.createElement("script");
    script.crossOrigin = "anonymous";
    script.src = `${assetsBase}/${name}`;
    const loaded = waitForAsset(script, name);
    document.body.appendChild(script);
    return loaded;
  };
  const jsonElement = (id, value) => {
    const element = document.createElement("script");
    element.id = id;
    element.type = "application/json";
    element.textContent = JSON.stringify(value).replaceAll("<", "\\u003c");
    document.head.appendChild(element);
  };

  function updateHostedContext(body) {
    const bridge = window.BuretteHostedAppBridge;
    if (!bridge) return;
    if (body?.type === "selectionChanged") {
      void bridge.updateSelection(record(body.selection), bounded(body.documentId, "active-structure"));
    }
    if (body?.type === "sceneActionsApplied") {
      void bridge.updateScene(record(body.report));
    }
  }

  function showBootstrapError(message) {
    let status = document.getElementById("status");
    if (!status) {
      const root = document.getElementById("root") || document.getElementById("app");
      root?.insertAdjacentHTML("afterend", '<div id="status"></div>');
      status = document.getElementById("status");
    }
    if (!status) return;
    status.className = "error";
    status.style.setProperty("display", "block", "important");
    status.textContent = `[web] Burette mobile renderer failed to start.\n\n${message}`;
  }

  const bootstrapTimeout = window.setTimeout(() => {
    if (!started) {
      showBootstrapError("Timed out waiting for molecular structure metadata from ChatGPT.");
    }
  }, BOOTSTRAP_TIMEOUT_MS);

  async function start(structure) {
    if (started) return;
    const root = document.getElementById("root");
    if (!root) throw new Error("Hosted viewer root is unavailable");
    started = true;
    window.clearTimeout(bootstrapTimeout);
    root.id = "app";
    let status = document.getElementById("status");
    if (!status) {
      root.insertAdjacentHTML("afterend", '<div id="status" class="loading">Loading structure...</div>');
    } else {
      status.className = "loading";
      status.textContent = "Loading structure...";
    }
    document.body.className = "burette-opaque-background burette-mobile-host";
    document.documentElement.classList.add("buret-hosted-mobile-direct");

    const runtimeScripts = [
      "viewer-shell.js",
      "viewer-bootstrap.js",
      "burette-agent.js",
      "trajectory-smoothing.js",
      "viewer.js",
    ];

    await Promise.all([
      addStylesheet("viewer-runtime.css"),
      addStylesheet("molstar.css"),
    ]);
    const documentId = `hosted-${Date.now()}`;
    jsonElement("burette-runtime-config", {
      format: structure.format,
      molstarFormat: structure.format,
      binary: false,
      renderer: "molstar",
      requestedRenderer: "molstar",
      allowMolstarFallback: false,
      label: structure.label,
      byteCount: structure.byteCount,
      previewByteCount: structure.byteCount,
      quickLookBuild: "burette-hosted-mobile-direct",
      debug: false,
      theme: "auto",
      canvasBackground: "auto",
      documentId,
      uiScale: 0.9,
      overlayOpacity: 0.9,
      transparentBackground: false,
      appViewer: true,
      tauriViewer: false,
      molstarStyle: "illustrative",
      molstarPreferWebgl1: true,
      molstarDisableAntialiasing: true,
      molstarPixelScale: 2,
      molstarPickScale: 0.75,
      molstarResolutionMode: "scaled",
      molstarPowerPreference: "default",
      waterRepresentation: "line",
      xyzrenderViewer: false,
      xyzrenderAvailable: false,
      molstarAvailable: true,
      showPanelControls: false,
      layoutShowControls: false,
      layoutShowSequence: false,
      layoutShowLog: false,
      layoutShowLeftPanel: false,
      hostedMcpActions: structure.actions,
      defaultLayoutState: { left: "hidden", right: "hidden", sequence: "hidden", log: "hidden" },
    });
    jsonElement("burette-runtime-data", base64Utf8(structure.data));

    await loadScript(runtimeScripts[0]);
    await loadScript(runtimeScripts[1]);
    window.BuretteMolstarURL = `${assetsBase}/molstar.js`;
    window.BuretteHostedAppBridge?.setSource(structure.source);
    void window.BuretteHostedAppBridge?.updateSelection(null, documentId);
    window.__mqlPost = (type, message, payload = {}) => {
      updateHostedContext({ type, message, ...payload, documentId });
    };
    for (const name of runtimeScripts.slice(2)) await loadScript(name);
  }

  function acceptResult(value) {
    if (started) return;
    const structure = structureFromResult(value);
    if (!structure) return;
    start(structure).catch((error) => {
      showBootstrapError(error?.message || String(error));
    });
  }

  function acceptOpenAIGlobals(globals) {
    const next = record(globals);
    if (!next) return;
    if (next.toolOutput !== undefined) latestToolOutput = next.toolOutput;
    if (next.toolResponseMetadata !== undefined) {
      latestToolResponseMetadata = next.toolResponseMetadata;
    }
    if (latestToolOutput === undefined && latestToolResponseMetadata === undefined) return;
    acceptResult({
      structuredContent: latestToolOutput,
      _meta: latestToolResponseMetadata,
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
    acceptOpenAIGlobals(event.detail?.globals);
  }, { passive: true });

  const queued = Array.isArray(window.__BURETTE_HOSTED_MCP_RESULTS__)
    ? window.__BURETTE_HOSTED_MCP_RESULTS__
    : [];
  for (const result of queued) {
    const queuedResult = record(result);
    if (queuedResult && (
      Object.hasOwn(queuedResult, "structuredContent")
      || Object.hasOwn(queuedResult, "_meta")
    )) {
      const globals = {};
      if (Object.hasOwn(queuedResult, "structuredContent")) {
        globals.toolOutput = queuedResult.structuredContent;
      }
      if (Object.hasOwn(queuedResult, "_meta")) {
        globals.toolResponseMetadata = queuedResult._meta;
      }
      acceptOpenAIGlobals(globals);
    } else {
      acceptResult(result);
    }
    if (started) break;
  }
  acceptOpenAIGlobals(window.__BURETTE_HOSTED_OPENAI_GLOBALS__);
  if (!started) acceptOpenAIGlobals(window.openai);
})();
