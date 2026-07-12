import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import {
  publicStructureOutputSchema,
  PUBLIC_OUTPUT_LIMITS,
  TOOL_ANNOTATIONS,
  viewerToolMeta,
} from "../lib/contracts";
import {
  createViewerResourceMeta,
  createViewerWidgetHtml,
  VIEWER_RESOURCE_URI,
  VIEWER_SHELL_SCRIPT_PATH,
  VIEWER_SHELL_STYLES_PATH,
} from "../lib/widget";
import {
  GET as getPluginRoot,
  PLUGIN_DOCUMENTATION_URL,
} from "../app/route";
import nextConfig from "../next.config";

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
    expect(meta.ui.visibility).toEqual(["model"]);
    expect(meta["openai/outputTemplate"]).toBe(VIEWER_RESOURCE_URI);
    expect(meta["openai/widgetAccessible"]).toBe(false);
  });
});

describe("viewer resource contract", () => {
  test("allows only the hosted Burrete runtime and same-origin assets", () => {
    const meta = createViewerResourceMeta("https://burrete.example");
    expect(meta.ui.domain).toBe("https://burrete.example");
    expect(meta.ui.csp.connectDomains).toEqual(["https://burrete.example"]);
    expect(meta.ui.csp.resourceDomains).toEqual(["https://burrete.example"]);
    expect(meta.ui.csp.frameDomains).toEqual(["https://burrete.example"]);
    expect(meta.ui.prefersBorder).toBe(false);
    expect(meta["openai/widgetPrefersBorder"]).toBe(false);
    expect(meta["openai/widgetCSP"].frame_domains).toEqual([
      "https://burrete.example",
    ]);
  });

  test("mounts the real Burrete shell directly and listens for MCP tool results", () => {
    const html = createViewerWidgetHtml("https://burrete.example");
    expect(VIEWER_RESOURCE_URI).toBe("ui://burrete/molecular-viewer-v8.html");
    expect(html).toContain(`https://burrete.example${VIEWER_SHELL_SCRIPT_PATH}`);
    expect(html).toContain(`https://burrete.example${VIEWER_SHELL_STYLES_PATH}`);
    expect(html).toContain("?v=viewer-hosted-toolbar-v1");
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("__BURRETE_HOSTED_MCP_WIDGET__");
    expect(html).toContain("__BURRETE_HOSTED_MCP_BRIDGE_READY__");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain("body .app-shell { width: 100%; height: 100%; }");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("Open full viewer");
    expect(html).not.toContain("OpenAI App");
    expect(html).not.toContain("molstar.Viewer");
    expect(html).not.toContain('class="metrics"');
    expect(html).not.toContain('class="header"');
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
    const shellAssets = headers?.find((entry) => entry.source === "/viewer-shell/:path*");
    expect(shellDocument?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: expect.stringContaining("frame-ancestors 'none'"),
    });
    expect(shellAssets?.headers).toContainEqual({
      key: "Access-Control-Allow-Origin",
      value: "*",
    });
  });

  test("redirects the service root to the public plugin documentation", () => {
    const response = getPluginRoot();
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(PLUGIN_DOCUMENTATION_URL);
  });
});
