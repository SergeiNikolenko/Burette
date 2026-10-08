import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { AgentIntegrationPanel } = await import("../apps/desktop/src/components/agent-integration-panel");
const status = {
  schema: "burette_agent_integration.v2", state: "update_available", appVersion: "1.0",
  bundledPlugin: { state: "ready", name: "burette", version: "2.0", path: "/bundle", displayName: "Burette", compatibility: { app: ">=1", agentCli: ">=2", controlApi: "v1" } },
  agentInstalls: [
    { id: "a", label: "Agent A", state: "update_available", version: "1.0", path: "/agent", message: "An older plugin is installed." },
    { id: "b", label: "Agent B", state: "not_installed", version: null, path: null, message: "Plugin not installed." },
  ],
  checks: [{ id: "mcp", label: "MCP server", state: "ok", detail: "Technical bundle detail." }, { id: "browser-shell", label: "Browser shell", state: "missing", detail: "Missing workspace assets." }, { id: "skills", label: "Skills", state: "ok", detail: "Bundled skills." }],
};
async function mountWith(fetcher: typeof fetch, run: (mount: HTMLDivElement) => Promise<void>) {
  const original = globalThis.fetch; globalThis.fetch = fetcher;
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount);
  try { await act(async () => root.render(<AgentIntegrationPanel embedded />)); await run(mount); }
  finally { await act(async () => root.unmount()); mount.remove(); globalThis.fetch = original; }
}
const button = (mount: Element, text: string) => Array.from(mount.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === text)!;

test("integration settings preserve installed versions and reveal diagnostics only on request", async () => {
  await mountWith((async () => Response.json(status)) as typeof fetch, async mount => {
    expect(Array.from(mount.querySelectorAll('[role="group"]')).map(row => row.textContent)).toEqual([
      "Burette pluginUpdate available", "Agent Av1.0Update available", "Agent BNot installed", "Molecular toolsReady", "Browser workspaceMissing", "WorkflowsReady",
    ]);
    expect(mount.textContent).not.toContain("Technical bundle detail.");
    expect(button(mount, "Reveal Bundle")).toBeUndefined(); // No native-only action in the browser.
    const trigger = button(mount, "Diagnostics");
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(mount.textContent).toContain("Technical bundle detail.");
    expect(mount.textContent).toContain("An older plugin is installed.");
    expect(mount.textContent).toContain("CLI compatibility>=2");
    expect(mount.textContent).toContain("Bundlev2.0Ready");
    await act(async () => trigger.click());
    expect(mount.textContent).not.toContain("Technical bundle detail.");
  });
});

test("checking blocks duplicate requests and a failed refresh removes stale ready states", async () => {
  let resolve!: (response: Response) => void; let count = 0;
  await mountWith((() => { count++; return new Promise<Response>(r => { resolve = r; }); }) as typeof fetch, async mount => {
    expect(button(mount, "Checking…").disabled).toBe(true);
    expect(mount.querySelector('[role="status"][aria-live]')?.textContent).toBe("Checking…");
    expect(mount.textContent).not.toContain("Ready");
    await act(async () => button(mount, "Checking…").click()); expect(count).toBe(1);
    await act(async () => resolve(Response.json({ ...status, state: "ready" })));
    expect(mount.querySelector('[role="status"][aria-live]')?.textContent).toBe("Ready");
    await act(async () => button(mount, "Refresh").click());
    await act(async () => resolve(new Response("failure", { status: 503 })));
    expect(mount.querySelector('[role="status"][aria-live]')?.textContent).toBe("Unavailable");
    expect(mount.textContent).not.toContain("Ready");
    expect(mount.textContent).not.toContain("503");
    expect(button(mount, "Refresh").disabled).toBe(false);
    await act(async () => button(mount, "Diagnostics").click());
    expect(mount.textContent).toContain("Status request failed (503)");
  });
});

test("static surfaces never report a fabricated ready plugin", async () => {
  for (const response of [new Response("not found", { status: 404 }), new Response("<html>shell</html>", { headers: { "content-type": "text/html" } })]) {
    await mountWith((async () => response) as typeof fetch, async mount => {
      expect(mount.querySelector('[role="status"][aria-live]')?.textContent).toBe("Unavailable");
      expect(mount.textContent).not.toContain("Ready");
      expect(mount.textContent).not.toContain("Components");
      await act(async () => button(mount, "Diagnostics").click());
      expect(mount.textContent).toContain("Open Burette on your desktop");
    });
  }
});

test("network failures remain retryable without exposing raw errors in the settings", async () => {
  await mountWith((async () => { throw new Error("private endpoint detail"); }) as typeof fetch, async mount => {
    expect(mount.querySelector('[role="status"][aria-live]')?.textContent).toBe("Unavailable");
    expect(mount.textContent).not.toContain("private endpoint detail");
    expect(button(mount, "Refresh").disabled).toBe(false);
    globalThis.fetch = (async () => Response.json(status)) as typeof fetch;
    await act(async () => button(mount, "Refresh").click());
    expect(mount.querySelector('[role="status"][aria-live]')?.textContent).toBe("Update available");
  });
});
