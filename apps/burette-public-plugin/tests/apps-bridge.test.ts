import { describe, expect, test } from "bun:test";
import { App } from "@modelcontextprotocol/ext-apps";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("MCP Apps bridge", () => {
  test("completes initialization before acknowledging model context updates", async () => {
    const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
    const methods: string[] = [];
    let downloadParams: unknown;
    hostTransport.onmessage = (message) => {
      if (!("id" in message) || typeof message.id !== "number" || !("method" in message)) return;
      methods.push(message.method);
      if (message.method === "ui/initialize") {
        const params = message.params as { protocolVersion: string };
        void hostTransport.send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: params.protocolVersion,
            hostInfo: { name: "test-host", version: "1.0.0" },
            hostCapabilities: {
              updateModelContext: { structuredContent: {} },
              downloadFile: {},
            },
            hostContext: {},
          },
        });
      } else if (message.method === "ui/update-model-context") {
        void hostTransport.send({ jsonrpc: "2.0", id: message.id, result: {} });
      } else if (message.method === "tools/call") {
        void hostTransport.send({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: "ok" }] },
        });
      } else if (message.method === "ui/download-file") {
        downloadParams = message.params;
        void hostTransport.send({ jsonrpc: "2.0", id: message.id, result: {} });
      }
    };
    await hostTransport.start();

    const app = new App(
      { name: "burette-test", version: "1.0.0" },
      {},
      { autoResize: false, strict: true },
    );
    await app.connect(appTransport);
    expect(app.getHostCapabilities()?.updateModelContext).toBeDefined();
    await app.updateModelContext({
      structuredContent: { burette: { activeSelection: null } },
    });
    await app.callServerTool({
      name: "control_ketcher",
      arguments: { action: { command: "get_structure" } },
    });
    await app.downloadFile({
      contents: [{
        type: "resource",
        resource: {
          uri: "file:///ketcher-sketch.sdf",
          mimeType: "chemical/x-mdl-sdfile",
          text: "M  END\n$$$$\n",
        },
      }],
    });
    expect(methods).toEqual([
      "ui/initialize",
      "ui/update-model-context",
      "tools/call",
      "ui/download-file",
    ]);
    expect(downloadParams).toEqual({
      contents: [{
        type: "resource",
        resource: {
          uri: "file:///ketcher-sketch.sdf",
          mimeType: "chemical/x-mdl-sdfile",
          text: "M  END\n$$$$\n",
        },
      }],
    });
    await app.close();
    await hostTransport.close();
  });
});
