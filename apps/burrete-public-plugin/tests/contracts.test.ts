import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";
import {
  publicStructureOutputSchema,
  PUBLIC_OUTPUT_LIMITS,
  TOOL_ANNOTATIONS,
  viewerToolMeta,
} from "../lib/contracts";
import {
  createStandaloneViewerHtml,
  createViewerResourceMeta,
  createViewerWidgetHtml,
  MOLSTAR_SCRIPT_PATH,
  VIEWER_RESOURCE_URI,
} from "../lib/widget";

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
  test("uses a narrow CSP without iframe domains", () => {
    const meta = createViewerResourceMeta("https://burrete.example");
    expect(meta.ui.domain).toBe("https://burrete.example");
    expect(meta.ui.csp.connectDomains).toEqual([]);
    expect(meta.ui.csp.resourceDomains).toEqual(["https://burrete.example"]);
    expect(meta.ui.prefersBorder).toBe(false);
    expect(meta["openai/widgetPrefersBorder"]).toBe(false);
    expect("frameDomains" in meta.ui.csp).toBe(false);
  });

  test("pins Molstar and listens for the MCP Apps tool-result notification", () => {
    const html = createViewerWidgetHtml("https://burrete.example");
    expect(html).toContain(`https://burrete.example${MOLSTAR_SCRIPT_PATH}`);
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("Open full viewer");
    expect(html).toContain("layoutIsExpanded: true");
    expect(html).toContain("layoutShowLeftPanel: true");
    expect(html).toContain("layoutShowLog: false");
    expect(html).toContain("collapseRightPanel: true");
    expect(html).toContain('disabledExtensions: ["mp4-export"]');
    expect(html).not.toContain('class="metrics"');
    expect(html).not.toContain('class="header"');
    expect(html).toContain("textContent");
    expect(html).not.toContain("<iframe");
  });

  test("boots the standalone URL directly into the full viewer", () => {
    const html = createStandaloneViewerHtml({
      structuredContent: { fileName: "example.pdb" },
      _meta: {
        structure: {
          data: "ATOM <script>alert('no')</script>",
          format: "pdb",
          label: "example.pdb",
        },
      },
    });
    expect(html).toContain('displayMode: "fullscreen"');
    expect(html).toContain("\\u003cscript>");
    expect(html).not.toContain("<script>alert('no')</script>");
  });
});
