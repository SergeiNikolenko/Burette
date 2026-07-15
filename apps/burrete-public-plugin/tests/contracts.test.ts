import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { z } from "zod/v4";
import {
  publicStructureOutputSchema,
  molecularSceneInputSchema,
  PUBLIC_OUTPUT_LIMITS,
  TOOL_ANNOTATIONS,
  viewerToolMeta,
} from "../lib/contracts";
import {
  createViewerResourceMeta,
  createViewerWidgetHtml,
  VIEWER_RESOURCE_URI,
  VIEWER_MOBILE_SCRIPT_PATH,
  VIEWER_APP_BRIDGE_SCRIPT_PATH,
  VIEWER_SHELL_SCRIPT_PATH,
  VIEWER_SHELL_STYLES_PATH,
} from "../lib/widget";
import {
  GET as getPluginRoot,
  PLUGIN_DOCUMENTATION_URL,
} from "../app/route";
import nextConfig from "../next.config";
import {
  createSceneContext,
  createSelectionContext,
  sanitizeViewerActions,
} from "../lib/hosted-context";

describe("submission tool contract", () => {
  test("sets every required action hint explicitly", () => {
    expect(TOOL_ANNOTATIONS).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  test("declares a parseable output schema", () => {
    const schema = z.object(publicStructureOutputSchema);
    const parsed = schema.parse({
      source: "rcsb",
      pdbId: "1CRN",
      fileName: "1CRN.pdb",
      format: "PDB",
      kind: "Macromolecule",
      summaryLine: "PDB macromolecule, 1 chain, 327 atoms, 0 ligand instances",
      byteCount: 1234,
      lineCount: 90,
      counts: { atoms: 327, chains: 1 },
      rows: [{ label: "Atoms", value: "327" }],
      components: { chains: [{ id: "A", atoms: 327 }] },
      notes: [],
      viewerAvailable: true,
    });
    expect(parsed.pdbId).toBe("1CRN");

    const jsonSchema = z.toJSONSchema(z.object(publicStructureOutputSchema), {
      io: "output",
    }) as {
      properties?: Record<string, { maxLength?: number; maxItems?: number }>;
    };
    expect(jsonSchema.properties?.summaryLine?.maxLength).toBe(
      PUBLIC_OUTPUT_LIMITS.scalarChars,
    );
    expect(jsonSchema.properties?.rows?.maxItems).toBe(PUBLIC_OUTPUT_LIMITS.rows);
  });

  test("links render tools to the versioned viewer resource", () => {
    const meta = viewerToolMeta("Loading…", "Loaded");
    expect(meta.ui.resourceUri).toBe(VIEWER_RESOURCE_URI);
    expect(meta.ui).toEqual({ resourceUri: VIEWER_RESOURCE_URI });
    expect(meta["openai/outputTemplate"]).toBe(VIEWER_RESOURCE_URI);
    expect(meta["openai/widgetAccessible"]).toBe(false);
  });

  test("bounds molecular scene actions and selector fields", () => {
    const schema = molecularSceneInputSchema;
    expect(schema.parse({
      source: "pdb",
      pdbId: "1CRN",
      actions: [{
        type: "select_residues",
        selector: { auth_asym_id: "A", beg_auth_seq_id: 10, end_auth_seq_id: 20 },
        mode: "replace",
      }],
    }).actions).toHaveLength(1);
    expect(() => schema.parse({
      source: "pdb",
      pdbId: "1CRN",
      actions: Array.from({ length: 9 }, () => ({ type: "reset_camera" })),
    })).toThrow();
    expect(() => schema.parse({
      source: "pdb",
      pdbId: "1CRN",
      actions: [{ type: "select_residues", selector: { arbitrary: "javascript" } }],
    })).toThrow();
  });
});

describe("viewer resource contract", () => {
  test("allows only the hosted Burrete runtime and same-origin assets", () => {
    const meta = createViewerResourceMeta("https://burrete.example");
    expect(meta.ui.domain).toBe("https://burrete.example");
    expect(meta.ui.csp.connectDomains).toEqual(["https://burrete.example"]);
    expect(meta.ui.csp.resourceDomains).toEqual(["https://burrete.example"]);
    expect(meta.ui.csp).not.toHaveProperty("frameDomains");
    expect(meta.ui.prefersBorder).toBe(false);
    expect(meta["openai/widgetPrefersBorder"]).toBe(false);
    expect(meta["openai/widgetCSP"]).not.toHaveProperty("frame_domains");
  });

  test("mounts the real Burrete shell directly and listens for MCP tool results", () => {
    const html = createViewerWidgetHtml("https://burrete.example");
    expect(VIEWER_RESOURCE_URI).toBe("ui://burrete/molecular-viewer-v18.html");
    expect(html).toContain(`https://burrete.example${VIEWER_SHELL_SCRIPT_PATH}`);
    expect(html).toContain(`https://burrete.example${VIEWER_SHELL_STYLES_PATH}`);
    expect(html).toContain("?v=viewer-v18");
    expect(html).toContain(`https://burrete.example${VIEWER_MOBILE_SCRIPT_PATH}`);
    expect(html).toContain(`https://burrete.example${VIEWER_APP_BRIDGE_SCRIPT_PATH}`);
    expect(html).toContain('window.matchMedia("(max-width: 600px)").matches');
    expect(html).toContain("navigator.userAgent");
    expect(html).toContain("iPhone|iPad|iPod");
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("__BURRETE_HOSTED_MCP_WIDGET__");
    expect(html).toContain(
      '"analyticsOrigin":"https://burrete.example"',
    );
    expect(html).toContain("__BURRETE_HOSTED_ANALYTICS_ORIGIN__");
    expect(html).toContain("__BURRETE_HOSTED_MCP_BRIDGE_READY__");
    expect(html).toContain("__BURRETE_HOSTED_OPENAI_GLOBALS__");
    expect(html).toContain("Burrete viewer failed to load.");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain("body .app-shell { width: 100%; height: 100%; }");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("Open full viewer");
    expect(html).not.toContain("OpenAI App");
    expect(html).not.toContain("molstar.Viewer");
    expect(html).not.toContain('class="metrics"');
    expect(html).not.toContain('class="header"');
  });

  test("uses a direct mobile viewer without a second iframe", () => {
    const source = readFileSync(path.resolve(
      import.meta.dir,
      "../assets/burrete-hosted-mobile.js",
    ), "utf8");
    expect(source).toContain('root.id = "app"');
    expect(source).toContain('quickLookBuild: "burrete-hosted-mobile-direct"');
    expect(source).toContain('document.body.className = "burette-opaque-background burette-mobile-host"');
    expect(source).toContain('molstarPowerPreference: "default"');
    expect(source).toContain('molstarPreferWebgl1: true');
    expect(source).toContain('molstarDisableAntialiasing: true');
    expect(source).toContain('molstarPixelScale: 0.75');
    expect(source).toContain('molstarPickScale: 0.75');
    expect(source).toContain('molstarResolutionMode: "scaled"');
    expect(source).toContain('layoutShowControls: false');
    expect(source).toContain('layoutShowSequence: false');
    expect(source).toContain('layoutShowLog: false');
    expect(source).toContain('layoutShowLeftPanel: false');
    expect(source).toContain('await Promise.all([\n      addStylesheet("viewer-runtime.css"),\n      addStylesheet("molstar.css"),\n    ])');
    expect(source).toContain('link.rel = "preload"');
    expect(source).toContain('link.as = "script"');
    expect(source).toContain('for (const name of runtimeScripts) preloadScript(name)');
    expect(source).toContain('canvasBackground: "black"');
    expect(source).toContain("BurreteHostedAppBridge");
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain("srcdoc");
  });

  test("starts the mobile viewer when tool output and metadata arrive separately", () => {
    const source = readFileSync(path.resolve(
      import.meta.dir,
      "../assets/burrete-hosted-mobile.js",
    ), "utf8");
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const root = {
      id: "root",
      insertedHtml: "",
      insertAdjacentHTML(_position: string, html: string) {
        this.insertedHtml = html;
      },
    };
    const createElement = () => {
      const elementListeners = new Map<string, Array<() => void>>();
      return {
        addEventListener(type: string, listener: () => void) {
          const handlers = elementListeners.get(type) || [];
          handlers.push(listener);
          elementListeners.set(type, handlers);
        },
        style: { setProperty() {} },
        textContent: "",
      };
    };
    const parent = {};
    const window = {
      parent,
      setTimeout: () => 1,
      clearTimeout() {},
      addEventListener(type: string, listener: (event: unknown) => void) {
        const handlers = listeners.get(type) || [];
        handlers.push(listener);
        listeners.set(type, handlers);
      },
      dispatchOpenAI(globals: Record<string, unknown>) {
        for (const listener of listeners.get("openai:set_globals") || []) {
          listener({ detail: { globals } });
        }
      },
    };
    const document = {
      body: { className: "", appendChild() {} },
      head: { appendChild() {} },
      documentElement: { classList: { add() {} } },
      getElementById(id: string) {
        return id === root.id ? root : null;
      },
      createElement,
    };

    vm.runInNewContext(source, {
      TextEncoder,
      btoa,
      document,
      navigator: { userAgent: "iPhone" },
      window,
    });

    window.dispatchOpenAI({ toolOutput: { fileName: "1CRN.pdb" } });
    expect(root.id).toBe("root");
    window.dispatchOpenAI({
      toolResponseMetadata: {
        structure: { data: "ATOM\nEND\n", format: "pdb", label: "1CRN.pdb" },
      },
    });
    expect(root.id).toBe("app");
    expect(root.insertedHtml).toContain("Loading structure");
  });

  test("initializes the Apps bridge before publishing bounded viewer state", () => {
    const source = readFileSync(path.resolve(
      import.meta.dir,
      "../assets/burrete-hosted-app.ts",
    ), "utf8");
    expect(source).toContain("new App(");
    expect(source).toContain("app.connect()");
    expect(source).toContain("getHostCapabilities()?.updateModelContext");
    expect(source).toContain("await app.updateModelContext(params)");
    expect(source).toContain('from "@vercel/analytics"');
    expect(source).toContain("disableAutoTrack: true");
    expect(source).toContain('viewEndpoint: `${analyticsOrigin}/api/analytics/view`');
    expect(source).toContain('route: "/mcp/widget", path: "/mcp/widget"');
    expect(source).not.toContain("pdbId");
    expect(source).not.toContain("fileName");

    const selection = createSelectionContext({
      source: "lasso",
      atoms: 1,
      residues: [{ chain: "A", sequence: 12, compId: "CYS" }],
      atomIdentities: [{ chain: "A", sequence: 12, compId: "CYS", atomName: "CA" }],
    }, "document-1", { kind: "pdb", pdbId: "1CRN" });
    expect(selection.structuredContent.burrete.activeSelection?.atomIdentities).toEqual([
      { chain: "A", sequence: 12, compId: "CYS", atomName: "CA" },
    ]);
    expect(selection.structuredContent.burrete.source).toEqual({ kind: "pdb", pdbId: "1CRN" });
    expect(createSelectionContext(null, "document-1", {
      kind: "attachment",
      fileName: "example.pdb",
      nested: { unbounded: "x".repeat(10_000) },
    }).structuredContent.burrete.source).toEqual({
      kind: "attachment",
      fileName: "example.pdb",
    });
    expect(createSelectionContext(null, "document-1").structuredContent.burrete.activeSelection).toBeNull();

    expect(sanitizeViewerActions([
      { type: "hide_components", kind: "water" },
      { type: "raw_burrete_agent", command: "loadMVS" },
      { type: "select_residues", selector: { auth_asym_id: "A" }, mode: "add" },
    ])).toEqual([{ type: "hide_components", kind: "water" }]);

    const scene = createSceneContext({
      revision: 2,
      selection: null,
      results: [{ ok: true, command: "hide_components" }],
    }, { kind: "pdb", pdbId: "1CRN" });
    expect(scene.structuredContent.burrete.scene.results).toEqual([
      { ok: true, command: "hide_components", error: null },
    ]);
  });

  test("uses a true black MCP widget background in dark mode", () => {
    const html = createViewerWidgetHtml("https://burrete.example");
    expect(html).toContain("background: #000000;");
    expect(html).toContain("html, body, #root, #app { min-height: 0; height: 100%; }");
    expect(html).not.toContain("background: #111315;");
  });

  test("builds the stable hosted shell entry assets", () => {
    const publicRoot = path.resolve(import.meta.dir, "../public");
    const shellScript = path.join(publicRoot, VIEWER_SHELL_SCRIPT_PATH.slice(1));
    expect(existsSync(shellScript)).toBe(true);
    expect(existsSync(path.join(publicRoot, VIEWER_SHELL_STYLES_PATH.slice(1)))).toBe(true);
    const source = readFileSync(shellScript, "utf8");
    const staticImports = [...source.matchAll(/from"([^"]+)"/gu)]
      .map((match) => match[1]);
    expect(staticImports.some((specifier) => specifier.includes("ketcher"))).toBe(false);
    expect(source).not.toContain("/private/tmp");
    expect(source).not.toContain("/Users/");
    expect(existsSync(path.join(publicRoot, "demo/1htb.pdb"))).toBe(false);
  });

  test("does not resandbox Mol* inside the isolated hosted widget", () => {
    const viewerFrameSource = readFileSync(path.resolve(
      import.meta.dir,
      "../../desktop/src/components/editor-area/viewer-frame.tsx",
    ), "utf8");
    expect(viewerFrameSource).toContain("? undefined");
    expect(viewerFrameSource).toContain("...(sandbox ? { sandbox } : {})");
  });

  test("bootstraps hosted viewer data without executable inline scripts", () => {
    const browserDocumentsSource = readFileSync(path.resolve(
      import.meta.dir,
      "../../desktop/src/lib/browser-dev-documents.ts",
    ), "utf8");
    expect(browserDocumentsSource).toContain('id="burrete-runtime-config" type="application/json"');
    expect(browserDocumentsSource).toContain('id="burrete-runtime-data" type="application/json"');
    expect(browserDocumentsSource).toContain('viewerAsset("viewer-bootstrap.js")');
    expect(browserDocumentsSource).toContain('WEB_ASSETS_BASE.replace(/\\/$/u, "")');
  });

  test("hardens the directly served shell and enables cross-origin assets", async () => {
    const headers = await nextConfig.headers?.();
    const shellDocument = headers?.find((entry) => entry.source === "/viewer-shell/index.html");
    const webDemoDocument = headers?.find((entry) => entry.source === "/web-demo/index.html");
    const shellAssets = headers?.find((entry) => entry.source === "/viewer-shell/:path*");
    expect(shellDocument?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: expect.stringContaining("frame-ancestors 'none'"),
    });
    expect(shellAssets?.headers).toContainEqual({
      key: "Access-Control-Allow-Origin",
      value: "*",
    });
    expect(webDemoDocument?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: expect.stringContaining("'unsafe-eval'"),
    });
    expect(webDemoDocument?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: expect.stringContaining("frame-ancestors 'self' https://burrete-landing.vercel.app"),
    });
  });

  test("redirects the service root to the public plugin documentation", () => {
    const response = getPluginRoot();
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(PLUGIN_DOCUMENTATION_URL);
  });
});
