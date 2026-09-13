import { expect } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function callInFreshInstance(
  name: string,
  arguments_: Record<string, unknown>,
  environment: Record<string, string> = {},
): Promise<CallToolResult> {
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("./review-case-instance.ts", import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      ...environment,
      BURETTE_REVIEW_TOOL_REQUEST: JSON.stringify({ name, arguments: arguments_ }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const errorText = Buffer.concat(stderr).toString("utf8");
  expect(exitCode, errorText).toBe(0);
  return JSON.parse(Buffer.concat(stdout).toString("utf8")) as CallToolResult;
}

export async function startSharedRedisRest() {
  const values = new Map<string, string>();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        const command = JSON.parse(body) as string[];
        let result: unknown;
        if (command[0] === "SET" && command.includes("NX")) {
          if (values.has(command[1])) result = null;
          else {
            values.set(command[1], command[2]);
            result = "OK";
          }
        } else if (command[0] === "GET") {
          result = values.get(command[1]) ?? null;
        } else if (command[0] === "EVAL") {
          const key = command[3];
          if (values.get(key) !== command[4]) result = 0;
          else {
            values.set(key, command[5]);
            result = 1;
          }
        } else {
          throw new Error(`Unexpected Redis command ${command[0]}`);
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result }));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid command" }));
      }
    });
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Shared Redis test server did not bind a TCP port.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
