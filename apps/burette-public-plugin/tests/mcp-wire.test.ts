import { describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { KETCHER_AGENT_API_VERSION } from "@burette/ketcher-agent-contract";
import { createKetcherWidgetHtml } from "../lib/widget";
import {
  exposeNoauthSecuritySchemes,
  NOAUTH_SECURITY_SCHEMES,
} from "../lib/contracts";
import { POST as handleMcpPost } from "../app/mcp/route";
import { prepareStructureText, structureSummaryText } from "../lib/structure-service";

async function readSseResponse(response: Response) {
  const dataLine = (await response.text())
    .split(/\r?\n/u)
    .find((line) => line.startsWith("data: "));
  expect(dataLine).toBeDefined();
  return JSON.parse(dataLine!.slice("data: ".length)) as Record<string, unknown>;
}

describe("MCP wire contract", () => {
  test("preserves the hosted drawing across reads and failures, and clears only on request", async () => {
    let nextId = 1;
    async function call(name: string, args: Record<string, unknown>) {
      const response = await handleMcpPost(new Request("https://burette.example/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
      }));
      expect(response.status).toBe(200);
      const payload = await readSseResponse(response) as {
        error?: unknown;
        result?: {
          isError?: boolean;
          structuredContent: { ok: boolean; surfaceId?: string; action?: Record<string, unknown> };
          _meta?: Record<string, unknown>;
        };
      };
      expect(payload.error).toBeUndefined();
      expect(payload.result).toBeDefined();
      return payload.result!;
    }

    const listeners = new Map<string, (event: unknown) => void>();
    let seedEvents = 0;
    const widgetWindow = {
      parent: {},
      __BURETTE_HOSTED_KETCHER_SEED__: null as { format: string; content: string } | null,
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      dispatchEvent: (event: Event) => { if (event.type === "burette-ketcher-seed") seedEvents++; },
    };
    const bootstrap = createKetcherWidgetHtml("https://burette.example").match(/<script>([\s\S]*?)<\/script>/u)?.[1];
    expect(bootstrap).toBeDefined();
    runInNewContext(bootstrap!, { window: widgetWindow, TextEncoder, CustomEvent });
    const deliver = (result: unknown) => listeners.get("message")?.({
      source: widgetWindow.parent,
      data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result },
    });

    const opened = await call("open_ketcher", { structure: { format: "smiles", content: "CCO" } });
    expect(opened.structuredContent.ok).toBe(true);
    deliver(opened);
    expect(widgetWindow.__BURETTE_HOSTED_KETCHER_SEED__?.content).toBe("CCO");
    const surfaceId = opened.structuredContent.surfaceId;
    async function control(command: string, extra: Record<string, unknown> = {}, expectedRevision = 1) {
      return call("control_ketcher", { action: {
        apiVersion: KETCHER_AGENT_API_VERSION, type: "control_ketcher", command,
        surfaceId, expectedRevision, ...extra,
      } });
    }

    for (const [command, extra, ok] of [
      ["get_structure", { formats: ["smiles"] }, true],
      ["highlight_atoms", { indexes: [0] }, true],
      ["request_persist", { format: "smiles" }, true],
      ["highlight_atoms", { indexes: [99] }, false],
    ] as const) {
      const result = await control(command, extra);
      expect(result.structuredContent.ok).toBe(ok);
      expect(result._meta).not.toHaveProperty("ketcherSeed");
      deliver(result);
      expect(widgetWindow.__BURETTE_HOSTED_KETCHER_SEED__?.content).toBe("CCO");
      expect(seedEvents).toBe(1);
    }
    const stale = await control("clear_structure", {}, 0);
    expect(stale.isError).toBe(true);
    deliver(stale);
    expect(widgetWindow.__BURETTE_HOSTED_KETCHER_SEED__?.content).toBe("CCO");
    expect(seedEvents).toBe(1);

    const set = await control("set_structure", { format: "smiles", content: "CCN" });
    expect(set.isError).toBeUndefined();
    expect(set.structuredContent.ok).toBe(true);
    expect(set.structuredContent.action).not.toHaveProperty("input");
    deliver(set);
    expect(widgetWindow.__BURETTE_HOSTED_KETCHER_SEED__?.content).toBe("CCN");
    expect(seedEvents).toBe(2);

    const cleared = await control("clear_structure", {}, 2);
    expect(cleared.structuredContent.ok).toBe(true);
    expect(cleared._meta?.ketcherSeed).toBeNull();
    deliver(cleared);
    expect(widgetWindow.__BURETTE_HOSTED_KETCHER_SEED__?.content).toBe("");
    expect(seedEvents).toBe(3);
  });

  test("starts cross-origin workers through a same-origin blob that keeps the script location", () => {
    const blobs = new Map<string, string>();
    const started: Array<{ url: string; options?: { type?: string } }> = [];
    class FakeWorker {
      constructor(url: string, options?: { type?: string }) { started.push({ url: String(url), options }); }
    }
    const FakeURL = Object.assign(function (url: string, base?: string) { return new URL(url, base); }, {
      createObjectURL: (blob: { source: string }) => {
        const url = `blob:https://sandbox.example/${blobs.size}`;
        blobs.set(url, blob.source);
        return url;
      },
    });
    const widgetWindow = { parent: {}, Worker: FakeWorker, addEventListener: () => {} } as Record<string, unknown>;
    const bootstrap = createKetcherWidgetHtml("https://burette.example").match(/<script>([\s\S]*?)<\/script>/u)?.[1];
    runInNewContext(bootstrap!, {
      window: widgetWindow, TextEncoder, CustomEvent, URL: FakeURL,
      Blob: class { source: string; constructor(parts: string[]) { this.source = parts.join(""); } },
      document: { baseURI: "https://sandbox.example/widget" },
      location: { origin: "https://sandbox.example" },
    });
    const Worker = widgetWindow.Worker as new (url: string, options?: { type?: string }) => unknown;
    const script = "https://burette.example/viewer-shell/assets/indigoWorker.js";
    new Worker(script, { type: "module" });
    new Worker(script);
    new Worker("https://sandbox.example/local-worker.js", { type: "module" });

    const setLocation = `Object.defineProperty(self, 'location', { value: new URL("${script}"), configurable: true });`;
    // Module workers would fetch the script under worker-src, which the host limits to blob:.
    expect(started.map(({ url, options }) => [blobs.get(url) ?? url, options?.type])).toEqual([
      [`${setLocation} importScripts("${script}");`, "classic"],
      [`${setLocation} importScripts("${script}");`, "classic"],
      ["https://sandbox.example/local-worker.js", "module"],
    ]);
  });

  test("serializes noauth security schemes at top level and in _meta", async () => {
    const server = new McpServer({ name: "wire-test", version: "1.0.0" });
    server.registerTool(
      "preview",
      {
        inputSchema: {},
        _meta: { securitySchemes: NOAUTH_SECURITY_SCHEMES },
      },
      async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    );
    exposeNoauthSecuritySchemes(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const pending = new Map<number, (message: Record<string, unknown>) => void>();
    clientTransport.onmessage = (message) => {
      const response = message as Record<string, unknown>;
      if (typeof response.id !== "number") return;
      pending.get(response.id)?.(response);
      pending.delete(response.id);
    };
    await clientTransport.start();
    await server.connect(serverTransport);

    let nextId = 1;
    async function request(method: string, params: Record<string, unknown>) {
      const id = nextId;
      nextId += 1;
      const response = new Promise<Record<string, unknown>>((resolve) => {
        pending.set(id, resolve);
      });
      await clientTransport.send({ jsonrpc: "2.0", id, method, params });
      return response;
    }

    await request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "wire-test", version: "1.0.0" },
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const response = await request("tools/list", {});
    const result = response.result as {
      tools: Array<{
        securitySchemes?: unknown;
        _meta?: { securitySchemes?: unknown };
      }>;
    };

    expect(result.tools[0]?.securitySchemes).toEqual(NOAUTH_SECURITY_SCHEMES);
    expect(result.tools[0]?._meta?.securitySchemes).toEqual(NOAUTH_SECURITY_SCHEMES);
    await server.close();
  });

  test("serializes output schemas for tools that return structured content", async () => {
    const server = new McpServer({ name: "wire-output-test", version: "1.0.0" });
    server.registerTool(
      "stateful",
      {
        inputSchema: {},
        outputSchema: { ok: z.boolean(), revision: z.number().int().nonnegative() },
      },
      async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        structuredContent: { ok: true, revision: 1 },
      }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const pending = new Map<number, (message: Record<string, unknown>) => void>();
    clientTransport.onmessage = (message) => {
      const response = message as Record<string, unknown>;
      if (typeof response.id !== "number") return;
      pending.get(response.id)?.(response);
      pending.delete(response.id);
    };
    await clientTransport.start();
    await server.connect(serverTransport);

    let nextId = 1;
    async function request(method: string, params: Record<string, unknown>) {
      const id = nextId;
      nextId += 1;
      const response = new Promise<Record<string, unknown>>((resolve) => pending.set(id, resolve));
      await clientTransport.send({ jsonrpc: "2.0", id, method, params });
      return response;
    }

    await request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "wire-output-test", version: "1.0.0" },
    });
    const response = await request("tools/list", {});
    const result = response.result as { tools: Array<{ outputSchema?: Record<string, unknown> }> };
    expect(result.tools[0]?.outputSchema?.required).toEqual(["ok", "revision"]);
    await server.close();
  });

  test("states the reviewed counts in the text the model answers from", async () => {
    const text = (file: string) => structureSummaryText(prepareStructureText(
      readFileSync(new URL(`../../../samples/${file}`, import.meta.url), "utf8"), file, "attachment",
    ).summary);
    expect(text("mini.pdb")).toBe("mini.pdb: PDB macromolecule, 1 chain, 9 atoms, 0 ligand instances. Atoms 9; Residues 2; Chains 1; Models 1; Elements C 5, N 2, O 2. chain A: 2 residues, 9 atoms.");
    expect(text("mini.cif")).toContain("chain A: 1 residue, 4 atoms.");
    expect(text("mini.sdf")).toBe("mini.sdf: SDF collection, 2 molecules, 9 atoms. Molecules 2; Atoms 9; Bonds 8; Elements C 6, H 2, O 1.");

    const response = await handleMcpPost(new Request("https://burette.example/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: "open_ketcher", arguments: { structure: { format: "smiles", content: "c1ccncc1O.[Na+]" } },
      } }),
    }));
    const payload = await readSseResponse(response) as { result: { content: Array<{ text: string }> } };
    expect(payload.result.content[0]!.text).toBe("Ketcher editor is ready with a molecule of 8 atoms and 7 bonds (SMILES c1ccncc1O.[Na+]) at structure revision 1. Nothing was written to a file.");
  });

  test("publishes output schemas and the submitted annotations for every public Burette tool", async () => {
    const response = await handleMcpPost(new Request("https://burette.example/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }));
    expect(response.status).toBe(200);

    const payload = await readSseResponse(response) as {
      result?: { tools?: Array<{ name?: string; outputSchema?: Record<string, unknown>; annotations?: Record<string, unknown> }> };
    };
    // Scan Tools imports the served annotations; the portal justifications must describe the same values.
    const submitted = JSON.parse(readFileSync(new URL("../chatgpt-app-submission.json", import.meta.url), "utf8")) as {
      tools: Record<string, { annotations: Record<string, boolean> }>;
    };
    const tools = payload.result?.tools ?? [];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "control_ketcher",
      "open_ketcher",
      "preview_molecular_file",
      "preview_pdb_structure",
      "render_molecular_scene",
    ]);
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject(submitted.tools[tool.name!]!.annotations);
    }
  });
});
