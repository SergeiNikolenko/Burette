import { describe, expect, test } from "bun:test";
import * as OCL from "openchemlib";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { runInNewContext } from "node:vm";
import { KETCHER_AGENT_API_VERSION } from "@burette/ketcher-agent-contract";
import { createKetcherWidgetHtml } from "../lib/widget";
import {
  exposeNoauthSecuritySchemes,
  NOAUTH_SECURITY_SCHEMES,
} from "../lib/contracts";
import { POST as handleMcpPost } from "../app/mcp/route";
import { callInFreshInstance, startSharedRedisRest } from "./review-instance-client";
import {
  acceptHostedKetcherResult,
  createHostedKetcherLineage,
  type HostedKetcherResult,
  type HostedKetcherState,
} from "../../desktop/src/lib/hosted-ketcher-sync";

async function readSseResponse(response: Response) {
  const dataLine = (await response.text())
    .split(/\r?\n/u)
    .find((line) => line.startsWith("data: "));
  expect(dataLine).toBeDefined();
  return JSON.parse(dataLine!.slice("data: ".length)) as Record<string, unknown>;
}

describe("MCP wire contract", () => {
  test("preserves the hosted drawing across reads and failures, and clears only on request", async () => {
    const redis = await startSharedRedisRest();
    const environment = {
      NODE_ENV: "production",
      PUBLIC_APP_ORIGIN: "https://burette.example",
      KETCHER_STATE_SECRET: "wire-drawing-review-secret",
      KETCHER_CAS_REDIS_REST_URL: "https://redis.example",
      KETCHER_CAS_REDIS_REST_TOKEN: "test-token",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      BURETTE_REVIEW_REDIS_PROXY_URL: redis.url,
    };
    type Seed = { format: string; content: string; surfaceId?: string };
    const listeners = new Map<string, (event: unknown) => void>();
    const queued: HostedKetcherResult<Seed>[] = [];
    const widgetWindow = {
      parent: {},
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      dispatchEvent: (event: CustomEvent<HostedKetcherResult<Seed>>) => {
        if (event.type === "burette-ketcher-result") queued.push(event.detail);
      },
    };
    const bootstrap = createKetcherWidgetHtml("https://burette.example").match(/<script>([\s\S]*?)<\/script>/u)?.[1];
    expect(bootstrap).toBeDefined();
    runInNewContext(bootstrap!, { window: widgetWindow, TextEncoder, CustomEvent });
    const lineage = createHostedKetcherLineage();
    let current: HostedKetcherState | null = null;
    let drawing: Seed | null = null;
    function currentState(): HostedKetcherState {
      if (!current) throw new Error("The widget has not accepted a Ketcher state.");
      return current;
    }
    async function deliver(result: CallToolResult) {
      listeners.get("message")?.({
        source: widgetWindow.parent,
        data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result },
      });
      for (const envelope of queued.splice(0)) {
        const outcome = await acceptHostedKetcherResult({
          current, lineage, result: envelope,
          applySeed: async (seed) => { drawing = seed; },
        });
        current = outcome.state;
      }
    }
    let nextActionId = 1;
    async function control(command: string, extra: Record<string, unknown> = {}, expectedRevision = 1) {
      expect(current?.continuationToken).toBeString();
      return callInFreshInstance("control_ketcher", { action: {
        apiVersion: KETCHER_AGENT_API_VERSION, type: "control_ketcher", command,
        surfaceId: currentState().surfaceId,
        continuationToken: currentState().continuationToken,
        actionId: "wire-drawing-" + nextActionId++,
        expectedRevision, ...extra,
      } }, environment);
    }
    const drawingSmiles = () => drawing
      ? OCL.Molecule.fromMolfile(drawing.content).toSmiles()
      : "";

    try {
      const opened = await callInFreshInstance("open_ketcher", {
        structure: { format: "smiles", content: "CCO" },
      }, environment);
      expect(opened.structuredContent?.ok).toBe(true);
      await deliver(opened);
      expect(drawingSmiles()).toBe("CCO");
      const initialDrawing = drawing;
      const initialToken = currentState().continuationToken;

      for (const [command, extra] of [
        ["get_structure", { formats: ["smiles"], delivery: "inline" }],
        ["highlight_atoms", { indexes: [0] }],
        ["request_persist", { format: "smiles" }],
      ] as const) {
        const result = await control(command, extra);
        expect(result.structuredContent?.ok).toBe(true);
        expect(result.structuredContent).not.toHaveProperty("result.result.ketcherSeed");
        await deliver(result);
        // Remount recovery carries a seed even for reads, but the drawing must
        // remain byte-for-byte identical while the continuation advances.
        expect(drawing).toEqual(initialDrawing);
        expect(currentState().snapshot?.structureRevision).toBe(1);
      }
      expect(currentState().continuationToken).not.toBe(initialToken);

      for (const [command, extra, revision, errorCode] of [
        ["highlight_atoms", { indexes: [99] }, 1, "INVALID_ATOM_INDEX"],
        ["clear_structure", {}, 0, "REVISION_CONFLICT"],
      ] as const) {
        const beforeFailure = current;
        const result = await control(command, extra, revision);
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({ ok: false, error: { code: errorCode } });
        expect(result._meta).not.toHaveProperty("ketcherSeed");
        await deliver(result);
        expect(drawing).toEqual(initialDrawing);
        expect(current).toEqual(beforeFailure);
      }

      const set = await control("set_structure", { format: "smiles", content: "CCN" });
      expect(set.isError).not.toBe(true);
      expect(set.structuredContent?.ok).toBe(true);
      expect(set.structuredContent).not.toHaveProperty("result.result.ketcherSeed");
      await deliver(set);
      expect(drawingSmiles()).toBe("CCN");
      expect(currentState().snapshot?.structureRevision).toBe(2);

      // A delayed original tool result must not roll back the newer drawing.
      await deliver(opened);
      expect(drawingSmiles()).toBe("CCN");
      expect(currentState().snapshot?.structureRevision).toBe(2);

      const cleared = await control("clear_structure", {}, 2);
      expect(cleared.structuredContent?.ok).toBe(true);
      expect(cleared._meta?.ketcherSeed).toBeNull();
      await deliver(cleared);
      expect(drawing).toBeNull();
      expect(currentState().snapshot?.structureRevision).toBe(3);
    } finally {
      await redis.close();
    }
  }, 30_000);

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
