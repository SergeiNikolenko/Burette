import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createReviewClient } from "./review-route-client";

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
