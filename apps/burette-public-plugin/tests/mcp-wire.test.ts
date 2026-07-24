import { describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import {
  exposeNoauthSecuritySchemes,
  NOAUTH_SECURITY_SCHEMES,
} from "../lib/contracts";

describe("MCP wire contract", () => {
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
});
