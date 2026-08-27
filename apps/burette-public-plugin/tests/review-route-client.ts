import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { POST } from "../app/mcp/route";

class LocalRouteTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    try {
      for (const response of await postRouteMessage(message)) this.onmessage?.(response);
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

export async function postRouteMessage(message: JSONRPCMessage): Promise<JSONRPCMessage[]> {
  const response = await POST(new Request("https://burette.review/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
    },
    body: JSON.stringify(message),
  }));
  const body = await response.text();
  return body
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as JSONRPCMessage);
}

export async function createReviewClient(): Promise<Client> {
  const client = new Client({ name: "burette-review-cases", version: "1.0.0" });
  await client.connect(new LocalRouteTransport());
  return client;
}
