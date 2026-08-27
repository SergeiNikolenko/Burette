import { App, type McpUiUpdateModelContextRequest } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { inject, pageview } from "@vercel/analytics";
import {
  createSceneContext,
  createSelectionContext,
  sanitizeViewerActions,
} from "../lib/hosted-context";

declare global {
  interface Window {
    BuretteHostedAppBridge?: {
      ready: Promise<boolean>;
      setSource: (source: unknown) => void;
      updateSelection: (selection: unknown, documentId: string) => Promise<boolean>;
      updateScene: (report: unknown) => Promise<boolean>;
      updateKetcher: (state: unknown) => Promise<boolean>;
      callServerTool: (
        name: string,
        arguments_?: Record<string, unknown>,
      ) => Promise<CallToolResult>;
      sanitizeViewerActions: (actions: unknown) => Record<string, unknown>[];
    };
    __BURETTE_HOSTED_APP_QUEUE__?: Array<{ method: string; args: unknown[] }>;
    __BURETTE_HOSTED_APP_READY__?: (ready: boolean) => void;
    __BURETTE_HOSTED_ANALYTICS_ORIGIN__?: string;
  }
}

const analyticsOrigin = window.__BURETTE_HOSTED_ANALYTICS_ORIGIN__;
if (analyticsOrigin?.startsWith("https://")) {
  inject({
    mode: "production",
    disableAutoTrack: true,
    scriptSrc: `${analyticsOrigin}/_vercel/insights/script.js`,
    viewEndpoint: `${analyticsOrigin}/api/analytics/view`,
  });
  pageview({ route: "/mcp/widget", path: "/mcp/widget" });
}

const app = new App(
  { name: "burette-molecular-viewer", version: "0.1.0" },
  {},
  { autoResize: true, strict: true },
);

let sourceDescriptor: unknown;
let connected = false;
const appConnected = app.connect().then(() => {
  connected = true;
  return true;
}).catch((error) => {
  console.error("Burette Apps bridge initialization failed", error);
  return false;
});
const ready = appConnected.then((initialized) => (
  initialized && app.getHostCapabilities()?.updateModelContext !== undefined
));

function ketcherModelContext(value: unknown): McpUiUpdateModelContextRequest["params"] {
  const state = record(value);
  const snapshot = record(state?.snapshot);
  const structure = record(snapshot?.structure);
  const surfaceId = bounded(state?.surfaceId, "hosted-ketcher").slice(0, 160);
  const continuationToken = boundedString(state?.continuationToken, 128 * 1024);
  const structureRevision = boundedNonnegativeInteger(snapshot?.structureRevision);
  const interactionRevision = boundedNonnegativeInteger(snapshot?.interactionRevision);
  const atomCount = boundedNonnegativeInteger(structure?.atomCount);
  const bondCount = boundedNonnegativeInteger(structure?.bondCount);
  const componentCount = boundedNonnegativeInteger(structure?.componentCount);
  const kind = ["empty", "molecule", "reaction"].includes(String(structure?.kind))
    ? String(structure?.kind)
    : "empty";
  return {
    content: [{
      type: "text" as const,
      text: `Hosted Ketcher surface ${surfaceId} is at structure revision ${structureRevision}.`,
    }],
    structuredContent: {
      burette: {
        ketcher: {
          surfaceId,
          continuationToken,
          structureRevision,
          interactionRevision,
          structure: { kind, atomCount, bondCount, componentCount },
        },
      },
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function bounded(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 255);
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function boundedNonnegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

async function updateModelContext(params: McpUiUpdateModelContextRequest["params"]) {
  if (!(await ready) || !connected) return false;
  await app.updateModelContext(params);
  return true;
}

async function callServerTool(
  name: string,
  arguments_: Record<string, unknown> = {},
) {
  if (!(await appConnected) || !connected) {
    throw new Error("Burette Apps bridge is not ready for server tool calls.");
  }
  return app.callServerTool({ name, arguments: arguments_ });
}

const queuedCalls = Array.isArray(window.__BURETTE_HOSTED_APP_QUEUE__)
  ? window.__BURETTE_HOSTED_APP_QUEUE__.splice(0)
  : [];
const bridge = {
  setSource(source: unknown) {
    sourceDescriptor = source;
  },
  updateSelection(selection: unknown, documentId: string) {
    return updateModelContext(createSelectionContext(selection, documentId, sourceDescriptor));
  },
  updateScene(report: unknown) {
    return updateModelContext(createSceneContext(report, sourceDescriptor));
  },
  updateKetcher(state: unknown) {
    return updateModelContext(ketcherModelContext(state));
  },
  callServerTool,
  sanitizeViewerActions,
  ready,
};
window.BuretteHostedAppBridge = bridge;
for (const call of queuedCalls) {
  if (call.method === "setSource") bridge.setSource(call.args[0]);
  else if (call.method === "updateSelection") {
    void bridge.updateSelection(call.args[0], String(call.args[1] || "active-structure"));
  } else if (call.method === "updateScene") void bridge.updateScene(call.args[0]);
  else if (call.method === "updateKetcher") void bridge.updateKetcher(call.args[0]);
}
void appConnected.then((initialized) => window.__BURETTE_HOSTED_APP_READY__?.(initialized));
