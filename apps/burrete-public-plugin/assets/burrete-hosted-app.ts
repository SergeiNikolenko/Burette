import { App, type McpUiUpdateModelContextRequest } from "@modelcontextprotocol/ext-apps";
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
    endpoint: `${analyticsOrigin}/_vercel/insights`,
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
const ready = app.connect().then(() => {
  connected = true;
  return app.getHostCapabilities()?.updateModelContext !== undefined;
}).catch((error) => {
  console.error("Burrete Apps bridge initialization failed", error);
  return false;
});

async function updateModelContext(params: McpUiUpdateModelContextRequest["params"]) {
  if (!(await ready) || !connected) return false;
  await app.updateModelContext(params);
  return true;
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
window.__BURRETE_HOSTED_APP_READY__?.(true);
