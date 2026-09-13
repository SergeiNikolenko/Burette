import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const redisProxyUrl = process.env.BURETTE_REVIEW_REDIS_PROXY_URL;
if (redisProxyUrl) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    return nativeFetch(url.origin === "https://redis.example" ? redisProxyUrl : input, init);
  }) as typeof fetch;
}

const { createReviewClient } = await import("./review-route-client");

const request = JSON.parse(process.env.BURETTE_REVIEW_TOOL_REQUEST ?? "null") as {
  name?: string;
  arguments?: Record<string, unknown>;
} | null;

if (!request?.name) throw new Error("BURETTE_REVIEW_TOOL_REQUEST must name one tool.");

const client = await createReviewClient();
try {
  await client.listTools();
  const result = await client.callTool({
    name: request.name,
    arguments: request.arguments ?? {},
  }) as CallToolResult;
  process.stdout.write(JSON.stringify(result));
} finally {
  await client.close();
}
