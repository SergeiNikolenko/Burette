import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as dns from "node:dns/promises";
import * as https from "node:https";
import { EventEmitter } from "node:events";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

const originalDns = { ...dns };
const originalHttps = { ...https };
let resolveHost = async (_hostname: string) => [{ address: "8.8.8.8", family: 4 }];
let respond: (response: IncomingMessage, index: number) => void;
const responses: IncomingMessage[] = [];
const requests: https.RequestOptions[] = [];

mock.module("node:dns/promises", () => ({ ...originalDns, lookup: (host: string) => resolveHost(host) }));
mock.module("node:https", () => ({
  ...originalHttps,
  request: (options: https.RequestOptions, callback: (response: IncomingMessage) => void) => {
    const index = requests.push(options) - 1;
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => queueMicrotask(() => {
      const response = new IncomingMessage(new Socket());
      response.statusCode = 200;
      responses.push(response);
      respond(response, index);
      const abort = () => {
        response.destroy(new Error("request aborted"));
        request.emit("error", new Error("request aborted"));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      response.once("close", () => options.signal?.removeEventListener("abort", abort));
      callback(response);
    });
    return request;
  },
}));

const { prepareAttachedStructure, MAX_PUBLIC_STRUCTURE_BYTES, STRUCTURE_FETCH_TIMEOUT_MS } =
  await import("../apps/burette-public-plugin/lib/structure-service");
const file = { download_url: "https://molecules.example/mini.xyz", file_id: "fixture", file_name: "mini.xyz" };
const xyz = "1\nHydrogen\nH 0 0 0\n";

afterEach(() => {
  mock.restore();
  resolveHost = async () => [{ address: "8.8.8.8", family: 4 }];
  for (const response of responses) response.destroy();
  responses.length = 0;
  requests.length = 0;
});

function shortDeadline() {
  const realTimeout = globalThis.setTimeout;
  spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler, delay: number, ...args: unknown[]) =>
    realTimeout(callback, delay === STRUCTURE_FETCH_TIMEOUT_MS ? 20 : delay, ...args)) as typeof setTimeout);
}

test("declared oversized response closes both response and socket before body consumption", async () => {
  respond = (response) => { response.headers["content-length"] = String(MAX_PUBLIC_STRUCTURE_BYTES + 1); };
  await expect(prepareAttachedStructure(file)).rejects.toMatchObject({ code: "STRUCTURE_TOO_LARGE" });
  expect(responses[0].destroyed).toBe(true);
  expect(responses[0].socket.destroyed).toBe(true);
});

test("unknown-length overflow also closes the response instead of returning a prefix", async () => {
  respond = (response) => { response.push(Buffer.alloc(MAX_PUBLIC_STRUCTURE_BYTES + 1)); response.push(null); };
  await expect(prepareAttachedStructure(file)).rejects.toMatchObject({ code: "STRUCTURE_TOO_LARGE" });
  expect(responses[0].destroyed).toBe(true);
});

test("valid redirected molecular text keeps pinned address, Host and TLS servername", async () => {
  respond = (response, index) => {
    if (index === 0) { response.statusCode = 302; response.headers.location = "/final.xyz"; }
    else { response.push(xyz); response.push(null); }
  };
  const result = await prepareAttachedStructure(file);
  expect(result.viewer.data).toBe(xyz);
  expect(result.summary.byteCount).toBe(Buffer.byteLength(xyz));
  expect(result.viewer.format).toBe("xyz");
  expect(responses[0].destroyed).toBe(true);
  expect(requests.map((request) => request.path)).toEqual(["/mini.xyz", "/final.xyz"]);
  expect(requests[1]).toMatchObject({ hostname: "8.8.8.8", servername: "molecules.example", headers: { Host: "molecules.example" } });
  expect(requests[0].signal).toBe(requests[1].signal);
});

test("pending DNS cannot outlive the request deadline or start a late HTTP request", async () => {
  shortDeadline();
  let finish!: (value: Array<{ address: string; family: number }>) => void;
  resolveHost = () => new Promise((resolve) => { finish = resolve; });
  await expect(prepareAttachedStructure(file)).rejects.toMatchObject({ code: "STRUCTURE_FETCH_TIMEOUT" });
  finish([{ address: "8.8.8.8", family: 4 }]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(requests).toHaveLength(0);
});

test("redirect DNS shares the original deadline and the prior response is closed", async () => {
  shortDeadline();
  resolveHost = async (host) => host === "molecules.example"
    ? [{ address: "8.8.8.8", family: 4 }]
    : new Promise(() => {});
  respond = (response) => { response.statusCode = 302; response.headers.location = "https://second.example/mini.xyz"; };
  await expect(prepareAttachedStructure(file)).rejects.toMatchObject({ code: "STRUCTURE_FETCH_TIMEOUT" });
  expect(requests).toHaveLength(1);
  expect(responses[0].destroyed).toBe(true);
});

test("stalled body is aborted and ordinary DNS failure keeps its error code", async () => {
  shortDeadline();
  respond = () => {};
  await expect(prepareAttachedStructure(file)).rejects.toMatchObject({ code: "STRUCTURE_FETCH_TIMEOUT" });
  expect(responses[0].destroyed).toBe(true);
  resolveHost = async () => { throw new Error("DNS fixture unavailable"); };
  await expect(prepareAttachedStructure(file)).rejects.toMatchObject({ code: "FILE_HOST_UNREACHABLE" });
});
