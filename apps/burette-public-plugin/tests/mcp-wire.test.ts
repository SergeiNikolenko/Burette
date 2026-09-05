import { describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { runInNewContext } from "node:vm";
import { KETCHER_AGENT_API_VERSION } from "@burette/ketcher-agent-contract";
import { createKetcherWidgetHtml } from "../lib/widget";
import {
  exposeNoauthSecuritySchemes,
  NOAUTH_SECURITY_SCHEMES,
} from "../lib/contracts";
import { POST as handleMcpPost } from "../app/mcp/route";

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

  test("publishes output schemas for every public Burette tool", async () => {
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
      result?: { tools?: Array<{ name?: string; outputSchema?: Record<string, unknown> }> };
    };
    const tools = payload.result?.tools ?? [];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "control_ketcher",
      "open_ketcher",
      "preview_molecular_file",
      "preview_pdb_structure",
      "render_molecular_scene",
    ]);
    for (const tool of tools) expect(tool.outputSchema).toBeDefined();
  });
});
