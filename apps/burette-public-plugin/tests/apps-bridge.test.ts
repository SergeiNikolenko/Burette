import { describe, expect, test } from "bun:test";
import { App } from "@modelcontextprotocol/ext-apps";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runInNewContext } from "node:vm";

describe("MCP Apps bridge", () => {
  test("initializes the bundled widget schemas without probing dynamic code", async () => {
    const bundle = await Bun.build({
      entrypoints: [new URL("../assets/burette-hosted-app.ts", import.meta.url).pathname],
      target: "browser", format: "esm", minify: true,
    });
    expect(bundle.success).toBe(true);
    let attempts = 0;
    const blocked = () => { attempts++; throw new Error("CSP blocks dynamic code"); };
    const reachedBootstrap = new Error("Schemas initialized; stop before host connection");
    const widgetWindow = {
      get __BURETTE_HOSTED_ANALYTICS_ORIGIN__() { throw reachedBootstrap; },
    };
    // Use the real bundled entry and its import order, not already-imported
    // test-process Zod modules. Stop at the first host-dependent operation.
    const script = await bundle.outputs[0]!.text();
    expect(() => runInNewContext(script, {
      window: widgetWindow, console, URL, TextEncoder, TextDecoder,
      AbortController, setTimeout, clearTimeout,
      Function: new Proxy(Function, { construct: blocked, apply: blocked }),
    }, { timeout: 5000, contextCodeGeneration: { strings: false, wasm: false } })).toThrow(reachedBootstrap);
    expect(attempts).toBe(0);
  });

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
