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
    BurreteHostedAppBridge?: {
      ready: Promise<boolean>;
      setSource: (source: unknown) => void;
      updateSelection: (selection: unknown, documentId: string) => Promise<boolean>;
      updateScene: (report: unknown) => Promise<boolean>;
      callServerTool: (
        name: string,
        arguments_?: Record<string, unknown>,
      ) => Promise<CallToolResult>;
      sanitizeViewerActions: (actions: unknown) => Record<string, unknown>[];
    };
    __BURRETE_HOSTED_APP_QUEUE__?: Array<{ method: string; args: unknown[] }>;
    __BURRETE_HOSTED_APP_READY__?: (ready: boolean) => void;
    __BURRETE_HOSTED_ANALYTICS_ORIGIN__?: string;
  }
}

const analyticsOrigin = window.__BURRETE_HOSTED_ANALYTICS_ORIGIN__;
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
  { name: "burrete-molecular-viewer", version: "0.1.0" },
  {},
  { autoResize: true, strict: true },
);

let sourceDescriptor: unknown;
let connected = false;
const appConnected = app.connect().then(() => {
  connected = true;
  return true;
}).catch((error) => {
  console.error("Burrete Apps bridge initialization failed", error);
  return false;
});
const ready = appConnected.then((initialized) => (
  initialized && app.getHostCapabilities()?.updateModelContext !== undefined
));

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
    throw new Error("Burrete Apps bridge is not ready for server tool calls.");
  }
  return app.callServerTool({ name, arguments: arguments_ });
}

const queuedCalls = Array.isArray(window.__BURRETE_HOSTED_APP_QUEUE__)
  ? window.__BURRETE_HOSTED_APP_QUEUE__.splice(0)
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
  callServerTool,
  sanitizeViewerActions,
  ready,
};
window.BurreteHostedAppBridge = bridge;
for (const call of queuedCalls) {
  if (call.method === "setSource") bridge.setSource(call.args[0]);
  else if (call.method === "updateSelection") {
    void bridge.updateSelection(call.args[0], String(call.args[1] || "active-structure"));
  } else if (call.method === "updateScene") void bridge.updateScene(call.args[0]);
}
void appConnected.then((initialized) => window.__BURRETE_HOSTED_APP_READY__?.(initialized));
