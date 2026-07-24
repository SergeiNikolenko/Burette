import { randomUUID } from "node:crypto";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { runBuretteAgent } from "../../lib/cli-bridge.mjs";
import {
  createWorkspaceSession,
  listWorkspaceSessions,
  resolveWorkspaceSession,
  updateWorkspaceSession,
} from "../../lib/session-registry.mjs";
import { componentSelector, editStructureFragmentFile, extractStructureComponentFile } from "../../lib/structure-components.mjs";
import { summarizeStructureFile } from "../../lib/structure-summary.mjs";
import { toolText } from "../../lib/tool-response.mjs";

const actionSchema = z.object({ type: z.string().trim().min(1) }).passthrough();
const externalActionSchema = z.object({ type: z.string().trim().min(1) }).passthrough();
const ketcherActionSchema = z.object({
  apiVersion: z.string().trim().min(1),
  type: z.string().trim().min(1),
  actionId: z.string().trim().min(1).optional(),
  surfaceId: z.string().trim().min(1),
  expectedRevision: z.number().int().min(0),
  command: z.enum(["set_structure", "clear_structure", "highlight_atoms", "get_structure", "request_persist"]),
}).passthrough();
const OBSERVE_ARRAY_LIMIT = 50;
const OBSERVE_BOUNDS_LIMIT = 100;
const OBSERVE_KEY_LIMIT = 128;
const OBSERVE_NODE_LIMIT = 2000;
const OBSERVE_OBJECT_KEY_LIMIT = 100;
const OBSERVE_OUTPUT_LIMIT = 256 * 1024;
const OBSERVE_STRING_LIMIT = 4096;
const OBSERVE_TOTAL_STRING_LIMIT = 64 * 1024;
const PUBLIC_CONTRACT = {
  apiVersion: "burette-external-agent/v1",
  tools: [
    "burette.get_context",
    "burette.open_workspace",
    "burette.open_ketcher",
    "burette.observe_workspace",
    "burette.control_viewer",
    "burette.control_ketcher",
    "burette.render_panel",
  ],
  advancedTools: [
    "open_burette_workspace",
    "observe_burette_workspace",
    "act_molstar_scene",
    "manage_burette_tabs",
    "manage_burette_structure_component",
    "open_burette_docking_view",
    "summarize_burette_structure",
  ],
  supportedFormats: ["pdb", "cif", "mmcif", "mol", "sdf", "xyz", "mae", "maegz"],
  capabilities: {
    canOpenWorkspace: true,
    canObserveWorkspace: true,
    canControlMolstar: true,
    canControlKetcher: true,
    canRenderPanels: true,
    canUseBrowserShell: true,
    canUseBrowserPreview: true,
    canUseDesktopApp: true,
  },
};

export function registerMolecularWorkspace(server) {
  registerAppTool(
    server,
    "burette.get_context",
    {
      title: "Get Burette Agent Context",
      description: "Return the short external-agent contract, known workspace sessions, and optional live workspace model context.",
      inputSchema: {
        workspaceSessionId: z.string().trim().optional(),
        viewerSessionId: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const hasLocator = Boolean(input.workspaceSessionId || input.viewerSessionId || input.url || input.sessionDir);
      if (!hasLocator) {
        return publicContractResult("burette.get_context", {
          ok: true,
          session: null,
          observe: null,
          result: workspaceSessionsResult(),
        });
      }
      const resolved = resolveWorkspaceSession(input);
      if (!resolved.ok) return publicContractFailure("burette.get_context", resolved.error);
      const observed = await observeWorkspaceSession(resolved.session);
      const readiness = workspaceReadiness(observed.payload?.result || null);
      const ready = observed.ok && readiness.ready;
      const session = updateKnownSession(resolved.session, {
        observe: observed.payload?.result || null,
      });
      return publicContractResult("burette.get_context", {
        ok: ready,
        session,
        observe: observed.payload?.result || null,
        result: workspaceSessionsResult(),
        started: true,
        ready,
        completionState: ready ? "ready" : "not_ready",
        error: ready ? null : observed.error || viewerNotReadyError(readiness),
        exitCode: observed.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burette.open_workspace",
    {
      title: "Open Burette Workspace",
      description: "Open a local molecular artifact and return a stable workspaceSessionId for external-agent follow-up actions.",
      inputSchema: {
        file: z.string().trim(),
        mode: z.enum(["auto", "browser-agent-shell", "browser-dev-shell", "browser-preview", "desktop-app"]).default("auto"),
        app: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        host: z.string().trim().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        noLaunch: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const mode = input.mode || "auto";
      const args = ["open", "--mode", mode];
      if (input.app) args.push("--app", input.app);
      if (input.sessionDir) args.push("--session-dir", input.sessionDir);
      if (input.host) args.push("--host", input.host);
      if (input.port) args.push("--port", String(input.port));
      if (input.noLaunch) args.push("--no-launch");
      args.push(input.file);
      const result = await runBuretteAgent(args, { timeoutMs: 45000 });
      if (!result.ok) {
        return publicContractFailure("burette.open_workspace", result.error, {
          exitCode: result.exitCode,
        });
      }
      const openResult = result.payload?.result || null;
      const structureSummary = await safeStructureSummary(input.file);
      const provisionalSession = createWorkspaceSession({
        file: input.file,
        mode,
        result: openResult,
        structureSummary,
      });
      const observed = await observeWorkspaceSession(provisionalSession);
      const readiness = workspaceReadiness(observed.payload?.result || null);
      const ready = observed.ok && readiness.ready;
      const awaitingBrowser = workspaceOpenAwaitingBrowser(observed, ready);
      const session = updateWorkspaceSession(provisionalSession.workspaceSessionId, {
        observe: observed.payload?.result || null,
      }) || provisionalSession;
      return publicContractResult("burette.open_workspace", {
        ok: ready || awaitingBrowser,
        session,
        observe: observed.payload?.result || null,
        result: openResult,
        structureSummary,
        started: true,
        ready,
        completionState: ready ? "ready" : awaitingBrowser ? "awaiting_browser" : "failed",
        error: ready || awaitingBrowser ? null : observed.error,
        exitCode: observed.exitCode ?? result.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burette.open_ketcher",
    {
      title: "Open Burette Ketcher",
      description: "Open a Ketcher chemical editor in an existing Burette workspace session.",
      inputSchema: {
        workspaceSessionId: z.string().trim().optional(),
        viewerSessionId: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { visibility: ["model"] },
      },
    },
    async input => {
      const resolved = resolveWorkspaceSession(input);
      if (!resolved.ok) return publicContractFailure("burette.open_ketcher", resolved.error);
      const actionResult = await runWorkspaceAction({
        url: resolved.session.url,
        sessionDir: resolved.session.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action: { type: "open_ketcher" },
      });
      const observed = actionResult.ok ? await observeWorkspaceSession(resolved.session) : null;
      const readiness = workspaceReadiness(observed?.payload?.result || null);
      const session = updateKnownSession(resolved.session, {
        observe: observed?.payload?.result || resolved.session.observe || null,
      });
      return publicContractResult("burette.open_ketcher", {
        ok: actionResult.ok,
        session,
        observe: observed?.payload?.result || null,
        result: actionResult.payload?.result || null,
        action: { type: "open_ketcher" },
        applied: actionResult.ok,
        ready: readiness.ready,
        completionState: readiness.ready ? "ready" : actionResult.ok ? "not_ready" : "failed",
        error: actionResult.ok ? null : actionResult.error || viewerNotReadyError(readiness),
        exitCode: actionResult.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burette.observe_workspace",
    {
      title: "Observe Burette Workspace",
      description: "Observe a workspace through workspaceSessionId or a direct url/sessionDir and return compact model context.",
      inputSchema: {
        workspaceSessionId: z.string().trim().optional(),
        viewerSessionId: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const resolved = resolveWorkspaceSession(input);
      if (!resolved.ok) return publicContractFailure("burette.observe_workspace", resolved.error);
      const observed = await observeWorkspaceSession(resolved.session);
      const readiness = workspaceReadiness(observed.payload?.result || null);
      const ready = observed.ok && readiness.ready;
      const session = updateKnownSession(resolved.session, {
        observe: observed.payload?.result || null,
      });
      return publicContractResult("burette.observe_workspace", {
        ok: ready,
        session,
        observe: observed.payload?.result || null,
        result: null,
        started: true,
        ready,
        completionState: ready ? "ready" : "not_ready",
        error: ready ? null : observed.error || viewerNotReadyError(readiness),
        exitCode: observed.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burette.control_viewer",
    {
      title: "Control Burette Viewer",
      description: "Run an allowlisted viewer action against a workspaceSessionId and return a refreshed model context.",
      inputSchema: {
        workspaceSessionId: z.string().trim().optional(),
        viewerSessionId: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        action: externalActionSchema,
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const resolved = resolveWorkspaceSession(input);
      if (!resolved.ok) return publicContractFailure("burette.control_viewer", resolved.error);
      const actionResult = await runWorkspaceAction({
        url: resolved.session.url,
        sessionDir: resolved.session.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action: input.action,
      });
      const observed = actionResult.ok ? await observeWorkspaceSession(resolved.session) : null;
      const session = updateKnownSession(resolved.session, {
        observe: observed?.payload?.result || resolved.session.observe || null,
      });
      return publicContractResult("burette.control_viewer", {
        ok: actionResult.ok,
        session,
        observe: observed?.payload?.result || null,
        result: actionResult.payload?.result || null,
        action: input.action,
        applied: actionResult.ok,
        error: actionResult.ok ? null : actionResult.error,
        exitCode: actionResult.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burette.control_ketcher",
    {
      title: "Control Burette Ketcher",
      description: "Apply a bounded, revision-checked action to the active Burette Ketcher surface.",
      inputSchema: {
        workspaceSessionId: z.string().trim().optional(),
        viewerSessionId: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        action: ketcherActionSchema,
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const resolved = resolveWorkspaceSession(input);
      if (!resolved.ok) return publicContractFailure("burette.control_ketcher", resolved.error);
      const action = input.action.actionId
        ? input.action
        : { ...input.action, actionId: randomUUID() };
      const actionResult = await runWorkspaceAction({
        url: resolved.session.url,
        sessionDir: resolved.session.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action,
      });
      const observed = actionResult.ok ? await observeWorkspaceSession(resolved.session) : null;
      const session = updateKnownSession(resolved.session, {
        observe: observed?.payload?.result || resolved.session.observe || null,
      });
      return publicContractResult("burette.control_ketcher", {
        ok: actionResult.ok,
        session,
        observe: observed?.payload?.result || null,
        result: actionResult.payload?.result || null,
        action,
        applied: actionResult.ok,
        error: actionResult.ok ? null : actionResult.error,
        exitCode: actionResult.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burette.render_panel",
    {
      title: "Render Burette Panel",
      description: "Render a markdown, table, or chart file into a Burette workspace dock through the short external-agent contract.",
      inputSchema: {
        workspaceSessionId: z.string().trim().optional(),
        viewerSessionId: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        kind: z.enum(["markdown", "table", "chart"]),
        file: z.string().trim(),
        area: z.enum(["right", "bottom"]).optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const resolved = resolveWorkspaceSession(input);
      if (!resolved.ok) return publicContractFailure("burette.render_panel", resolved.error);
      const action = {
        type: "render_panel",
        kind: input.kind,
        file: input.file,
        area: input.area || "right",
      };
      const actionResult = await runWorkspaceAction({
        url: resolved.session.url,
        sessionDir: resolved.session.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action,
      });
      const observed = actionResult.ok ? await observeWorkspaceSession(resolved.session) : null;
      const session = updateKnownSession(resolved.session, {
        observe: observed?.payload?.result || resolved.session.observe || null,
      });
      return publicContractResult("burette.render_panel", {
        ok: actionResult.ok,
        session,
        observe: observed?.payload?.result || null,
        result: actionResult.payload?.result || null,
        action,
        applied: actionResult.ok,
        error: actionResult.ok ? null : actionResult.error,
        exitCode: actionResult.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "open_burette_workspace",
    {
      title: "Open Burette Workspace",
      description: "Open a local molecular artifact in the full Browser shell, Browser preview, or the real Burette desktop app through the repository CLI.",
      inputSchema: {
        file: z.string().trim(),
        mode: z.enum(["auto", "browser-agent-shell", "browser-dev-shell", "browser-preview", "desktop-app"]).default("auto"),
        app: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        host: z.string().trim().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        noLaunch: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const args = ["open", "--mode", input.mode];
      if (input.app) args.push("--app", input.app);
      if (input.sessionDir) args.push("--session-dir", input.sessionDir);
      if (input.host) args.push("--host", input.host);
      if (input.port) args.push("--port", String(input.port));
      if (input.noLaunch) args.push("--no-launch");
      args.push(input.file);
      const result = await runBuretteAgent(args, { timeoutMs: 45000 });
      const structureSummary = await safeStructureSummary(input.file);
      if (!result.ok) return cliToolResult("open_burette_workspace", result, { structureSummary });
      const openResult = result.payload?.result || null;
      const observed = await observeWorkspaceSession({
        url: openResult?.url,
        sessionDir: openResult?.sessionDir,
      });
      return observedWorkspaceToolResult("open_burette_workspace", {
        started: true,
        result: openResult,
        observed,
        structureSummary,
        allowAwaitingBrowser: true,
      });
    },
  );

  registerAppTool(
    server,
    "summarize_burette_structure",
    {
      title: "Summarize Burette Structure",
      description: "Read a local molecular file, or the active Burette workspace document, and return an Info-panel-style structured summary for agent planning.",
      inputSchema: {
        file: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const resolved = await resolveStructureSummaryTarget(input);
      if (!resolved.ok) {
        return {
          content: toolText(`summarize_burette_structure failed: ${resolved.error.message}`),
          structuredContent: {
            ok: false,
            tool: "summarize_burette_structure",
            summary: null,
            observe: boundedWorkspaceObserve(resolved.observe || null),
            error: resolved.error,
          },
        };
      }
      const summary = boundedStructureSummary(await summarizeStructureFile(resolved.file));
      return {
        content: toolText(`summarize_burette_structure completed: ${summary.summaryLine}`),
        structuredContent: {
          ok: true,
          tool: "summarize_burette_structure",
          summary,
          observe: boundedWorkspaceObserve(resolved.observe || null),
          error: null,
        },
      };
    },
  );

  registerAppTool(
    server,
    "observe_burette_workspace",
    {
      title: "Observe Burette Workspace",
      description: "Read structured Burette workspace state from a tokenized Browser preview URL or desktop session directory.",
      inputSchema: {
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const args = ["observe"];
      if (input.url) args.push("--url", input.url);
      if (input.sessionDir) args.push("--session-dir", input.sessionDir);
      const result = await runBuretteAgent(args);
      return observedWorkspaceToolResult("observe_burette_workspace", {
        started: true,
        result: null,
        observed: result,
      });
    },
  );

  registerAppTool(
    server,
    "manage_burette_tabs",
    {
      title: "Manage Burette Tabs",
      description: "List, focus, open, close, and move tabs inside the active Burette Browser shell or desktop workspace.",
      inputSchema: {
        operation: z.enum(["list", "focus", "next", "previous", "open_file", "new", "close", "move"]),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        tabId: z.string().trim().optional(),
        index: z.number().int().min(0).optional(),
        path: z.string().trim().optional(),
        title: z.string().trim().optional(),
        toIndex: z.number().int().min(0).optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      if (input.operation === "list") {
        const args = ["observe"];
        if (input.url) args.push("--url", input.url);
        if (input.sessionDir) args.push("--session-dir", input.sessionDir);
        const result = await runBuretteAgent(args);
        return cliToolResult("manage_burette_tabs", result, {
          tabs: result.payload?.result?.tabs || [],
          activeTabId: result.payload?.result?.activeTabId || null,
        });
      }

      const action = {
        type: "manage_tabs",
        operation: input.operation,
        tabId: input.tabId,
        index: input.index,
        path: input.path,
        title: input.title,
        toIndex: input.toIndex,
      };
      const args = ["act"];
      if (input.url) args.push("--url", input.url);
      if (input.sessionDir) args.push("--session-dir", input.sessionDir);
      args.push(JSON.stringify(action));
      const waitMs = input.waitMs ?? 12000;
      args.push("--wait-ms", String(waitMs));
      const result = await runBuretteAgent(args, { timeoutMs: Math.max(30000, waitMs + 5000) });
      return cliToolResult("manage_burette_tabs", result);
    },
  );

  registerAppTool(
    server,
    "manage_burette_structure_component",
    {
      title: "Manage Burette Structure Component",
      description: "Select, focus, hide, show, clear, or open a chain/ligand/water/ion/polymer/element from the active Burette structure as its own tab.",
      inputSchema: {
        operation: z.enum(["select", "focus", "hide", "show", "clear", "open_as_tab"]),
        component: z.enum(["polymer", "ligand", "water", "ion", "chain", "element"]).optional(),
        file: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        chain: z.string().trim().optional(),
        compId: z.string().trim().optional(),
        seq: z.union([z.string().trim(), z.number().int()]).optional(),
        element: z.string().trim().optional(),
        title: z.string().trim().optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const resolved = await resolveStructureComponentTarget(input);
      if (!resolved.ok) {
        return {
          content: toolText(`manage_burette_structure_component failed: ${resolved.error.message}`),
          structuredContent: {
            ok: false,
            tool: "manage_burette_structure_component",
            error: resolved.error,
            observe: resolved.observe || null,
          },
        };
      }

      if (input.operation === "open_as_tab") {
        const extracted = await extractStructureComponentFile({
          file: resolved.file,
          component: input.component,
          chain: input.chain,
          compId: input.compId,
          seq: input.seq,
          element: input.element,
          title: input.title,
        });
        const result = await runWorkspaceAction({
          url: input.url,
          sessionDir: input.sessionDir,
          waitMs: input.waitMs ?? 12000,
          action: {
            type: "open_files",
            paths: [extracted.outputPath],
          },
        });
        if (!result.ok) return cliToolResult("manage_burette_structure_component", result, { extracted });
        const readiness = await waitForWorkspaceDocumentReady({
          url: input.url,
          sessionDir: input.sessionDir,
          path: extracted.outputPath,
          waitMs: input.waitMs ?? 12000,
        });
        const error = readiness.ok ? null : boundedToolError(readiness.error);
        return {
          content: toolText(readiness.ok
            ? `manage_burette_structure_component completed: ${extracted.outputPath} is ready.`
            : `manage_burette_structure_component is not complete: ${error.message}`),
          ...(readiness.ok ? {} : { isError: true }),
          structuredContent: {
            ok: readiness.ok,
            tool: "manage_burette_structure_component",
            started: true,
            ready: readiness.ok,
            completionState: readiness.ok ? "ready" : "not_ready",
            result: result.payload?.result || null,
            extracted,
            observe: boundedWorkspaceObserve(readiness.observe),
            error,
            exitCode: readiness.exitCode,
          },
        };
      }

      const action = structureComponentAction(input);
      if (!action.ok) {
        return {
          content: toolText(`manage_burette_structure_component failed: ${action.error.message}`),
          structuredContent: {
            ok: false,
            tool: "manage_burette_structure_component",
            error: action.error,
          },
        };
      }
      const result = await runWorkspaceAction({
        url: input.url,
        sessionDir: input.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action: action.value,
      });
      return cliToolResult("manage_burette_structure_component", result, {
        selector: action.value.selector || null,
      });
    },
  );

  registerAppTool(
    server,
    "open_burette_docking_view",
    {
      title: "Open Burette Docking View",
      description: "Open a Mol* docking or combined structure-scene view inside the active Burette Browser shell or desktop workspace.",
      inputSchema: {
        receptorPath: z.string().trim(),
        ligandPaths: z.array(z.string().trim()).min(1),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        activePose: z.number().int().min(0).optional(),
        sceneMode: z.enum(["structureAll", "structurePoses"]).optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const result = await runWorkspaceAction({
        url: input.url,
        sessionDir: input.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action: {
          type: "open_docking_view",
          receptorPath: input.receptorPath,
          ligandPaths: input.ligandPaths,
          activePose: input.activePose,
          sceneMode: input.sceneMode,
        },
      });
      return cliToolResult("open_burette_docking_view", result);
    },
  );

  registerAppTool(
    server,
    "set_burette_trajectory",
    {
      title: "Set Burette Trajectory",
      description: "Switch the active Mol* trajectory/model/pose frame and optionally toggle single/all pose overlay mode.",
      inputSchema: {
        index: z.number().int().min(0),
        mode: z.enum(["auto", "structure", "sdf-pose"]).default("auto").optional(),
        poseMode: z.enum(["single", "all"]).optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const results = [];
      if (input.poseMode) {
        results.push(await runWorkspaceAction({
          url: input.url,
          sessionDir: input.sessionDir,
          waitMs: input.waitMs ?? 12000,
          action: {
            type: "set_sdf_pose_mode",
            mode: input.poseMode,
          },
        }));
      }
      const actionType = input.mode === "sdf-pose" ? "set_sdf_pose_index" : "set_structure_pose";
      const result = await runWorkspaceAction({
        url: input.url,
        sessionDir: input.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action: {
          type: actionType,
          index: input.index,
        },
      });
      results.push(result);
      return cliToolResult("set_burette_trajectory", result, {
        results: results.map((item) => item.payload?.result || item.error || null),
        actionType,
      });
    },
  );

  registerAppTool(
    server,
    "set_burette_representation_style",
    {
      title: "Set Burette Representation Style",
      description: "Change the active Mol* representation style through an allowlisted viewer action.",
      inputSchema: {
        style: z.enum(["default", "illustrative", "polymer-ligand", "cartoon", "ball-and-stick", "spacefill", "line", "molecular-surface"]),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const result = await runWorkspaceAction({
        url: input.url,
        sessionDir: input.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action: {
          type: "set_molstar_style",
          style: input.style,
        },
      });
      return cliToolResult("set_burette_representation_style", result, { style: input.style });
    },
  );

  registerAppTool(
    server,
    "focus_burette_selection",
    {
      title: "Focus Burette Selection",
      description: "Select, focus, highlight, label, or clear a Mol* fragment selection by selector.",
      inputSchema: {
        operation: z.enum(["select", "focus", "highlight", "label", "clear"]),
        selector: z.record(z.unknown()).optional(),
        label: z.string().trim().optional(),
        text: z.string().trim().optional(),
        color: z.string().trim().optional(),
        mode: z.enum(["replace", "add"]).optional(),
        granularity: z.enum(["element", "residue"]).optional(),
        durationMs: z.number().int().min(0).max(60000).optional(),
        extraRadius: z.number().min(0).optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const action = selectionAction(input);
      const result = await runWorkspaceAction({
        url: input.url,
        sessionDir: input.sessionDir,
        waitMs: input.waitMs ?? 12000,
        action,
      });
      return cliToolResult("focus_burette_selection", result, { action });
    },
  );

  registerAppTool(
    server,
    "edit_burette_fragment",
    {
      title: "Edit Burette Fragment",
      description: "Create a derived PDB by extracting, removing, or replacing a matched fragment without mutating the source file.",
      inputSchema: {
        operation: z.enum(["extract", "remove_to_new_file", "replace_to_new_file"]),
        file: z.string().trim(),
        component: z.enum(["polymer", "ligand", "water", "ion", "chain", "element"]).optional(),
        chain: z.string().trim().optional(),
        compId: z.string().trim().optional(),
        seq: z.union([z.string().trim(), z.number().int()]).optional(),
        element: z.string().trim().optional(),
        replacementFile: z.string().trim().optional(),
        title: z.string().trim().optional(),
        openAsTab: z.boolean().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const edited = await editStructureFragmentFile(input);
      let opened = null;
      let readiness = null;
      if (input.openAsTab) {
        opened = await runWorkspaceAction({
          url: input.url,
          sessionDir: input.sessionDir,
          waitMs: input.waitMs ?? 12000,
          action: {
            type: "open_files",
            paths: [edited.outputPath],
          },
        });
        if (opened.ok) {
          readiness = await waitForWorkspaceDocumentReady({
            url: input.url,
            sessionDir: input.sessionDir,
            path: edited.outputPath,
            waitMs: input.waitMs ?? 12000,
          });
        }
      }
      const ok = !opened || (opened.ok && readiness?.ok === true);
      const error = ok ? null : boundedToolError(opened?.error || readiness?.error || {
        code: "WORKSPACE_DOCUMENT_NOT_READY",
        message: "The derived file was created, but its viewer readiness could not be confirmed.",
      });
      return {
        content: toolText(ok
          ? `edit_burette_fragment completed: ${edited.outputPath}`
          : `edit_burette_fragment created ${edited.outputPath}, but the derived viewer is not ready: ${error.message}`),
        ...(ok ? {} : { isError: true }),
        structuredContent: {
          ok,
          tool: "edit_burette_fragment",
          started: Boolean(opened),
          ready: opened ? readiness?.ok === true : null,
          completionState: opened ? (readiness?.ok ? "ready" : "not_ready") : "created",
          edited,
          opened: opened?.payload?.result || null,
          observe: boundedWorkspaceObserve(readiness?.observe || null),
          error,
          exitCode: readiness?.exitCode ?? opened?.exitCode ?? null,
        },
      };
    },
  );

  registerAppTool(
    server,
    "act_molstar_scene",
    {
      title: "Act On Molstar Scene",
      description: "Queue an allowlisted high-level or declarative Mol* scene action through the Burette agent contract.",
      inputSchema: {
        action: actionSchema,
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        waitMs: z.number().int().min(0).max(60000).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["model"],
        },
      },
    },
    async input => {
      const args = ["act"];
      if (input.url) args.push("--url", input.url);
      if (input.sessionDir) args.push("--session-dir", input.sessionDir);
      args.push(JSON.stringify(input.action));
      if (input.waitMs) args.push("--wait-ms", String(input.waitMs));
      const result = await runBuretteAgent(args, { timeoutMs: Math.max(30000, (input.waitMs || 0) + 5000) });
      return cliToolResult("act_molstar_scene", result);
    },
  );

}

async function observeWorkspaceSession(session) {
  const args = ["observe"];
  const locator = workspaceLocatorArgs(session);
  if (!locator.ok) return missingWorkspaceLocatorResult(locator.error);
  args.push(...locator.args);
  return await runBuretteAgent(args);
}

function updateKnownSession(session, patch) {
  if (session?.workspaceSessionId) {
    return updateWorkspaceSession(session.workspaceSessionId, patch) || { ...session, ...patch };
  }
  return { ...session, ...patch };
}

function workspaceLocatorArgs(session) {
  if (session?.url) return { ok: true, args: ["--url", session.url] };
  if (session?.sessionDir) return { ok: true, args: ["--session-dir", session.sessionDir] };
  return {
    ok: false,
    error: {
      code: "WORKSPACE_LOCATOR_UNAVAILABLE",
      message: "The workspace session does not include a url or sessionDir.",
    },
  };
}

function missingWorkspaceLocatorResult(error) {
  return {
    ok: false,
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    error,
  };
}

function workspaceSessionsResult() {
  const sessions = listWorkspaceSessions();
  const budget = createObserveBudget();
  const boundedSessions = boundObserveValue(sessions.slice(0, OBSERVE_ARRAY_LIMIT), "sessions", 0, budget);
  return {
    sessions: boundedSessions,
    sessionCount: sessions.length,
    sessionsTruncated: sessions.length > boundedSessions.length,
  };
}

function publicContractResult(tool, {
  ok,
  session = null,
  observe = null,
  result = null,
  structureSummary = null,
  action = null,
  applied = null,
  started = null,
  ready = null,
  completionState = null,
  error = null,
  exitCode = null,
}) {
  const boundedObserve = boundedWorkspaceObserve(observe);
  const boundedError = boundedToolError(error);
  const modelContext = buildModelContext({ session, observe: boundedObserve, structureSummary: structureSummary || session?.structureSummary || null });
  return {
    content: toolText(completionState === "awaiting_browser"
      ? `${tool} started. Open the returned workspace URL, then call burette.observe_workspace. Do not claim that the structure is visible until ready is true and the central canvas is visually verified.`
      : ok
        ? `${tool} completed.`
      : completionState === "not_ready"
        ? `${tool} is not complete: ${boundedError?.message || "the molecular viewer is not ready"}`
        : `${tool} failed: ${boundedError?.message || "unknown error"}`),
    ...(ok ? {} : { isError: true }),
    structuredContent: {
      ok,
      tool,
      apiVersion: PUBLIC_CONTRACT.apiVersion,
      workspaceSessionId: session?.workspaceSessionId || null,
      viewerSessionId: session?.workspaceSessionId || null,
      surface: session?.surface || modelContext.surface,
      capabilities: PUBLIC_CONTRACT.capabilities,
      supportedFormats: PUBLIC_CONTRACT.supportedFormats,
      activeDocument: modelContext.activeDocument,
      modelContext,
      result,
      action,
      applied: applied === null ? inferApplied(ok, result) : applied,
      started,
      ready,
      completionState,
      observe: boundedObserve,
      sessions: result?.sessions || undefined,
      error: ok ? null : boundedError,
      exitCode,
    },
  };
}

function publicContractFailure(tool, error, { exitCode = null } = {}) {
  return publicContractResult(tool, {
    ok: false,
    error,
    exitCode,
  });
}

function buildModelContext({ session, observe, structureSummary }) {
  const activeDocument = observe?.activeDocument || (session?.file
    ? {
        path: session.file,
        title: fileTitle(session.file),
        ready: false,
      }
    : null);
  return {
    apiVersion: PUBLIC_CONTRACT.apiVersion,
    workspaceSessionId: session?.workspaceSessionId || null,
    viewerSessionId: session?.workspaceSessionId || null,
    mode: observe?.mode || session?.mode || null,
    surface: session?.surface || surfaceFromMode(observe?.mode || session?.mode),
    activeDocument,
    activeSurface: observe?.activeSurface || null,
    chemicalEditor: observe?.chemicalEditor || null,
    viewer: observe?.viewer || observe?.viewerAgent || null,
    scene: observe?.scene || null,
    tabs: Array.isArray(observe?.tabs) ? observe.tabs.map(tab => ({
      id: tab.id,
      title: tab.title,
      path: tab.path,
      active: Boolean(tab.active || tab.id === observe.activeTabId),
    })) : [],
    panels: Array.isArray(observe?.workspacePanels) ? observe.workspacePanels : [],
    structureSummary: briefStructureSummary(structureSummary),
    nextActions: PUBLIC_CONTRACT.tools,
  };
}

function briefStructureSummary(summary) {
  if (!summary || summary.ok === false) return summary || null;
  const bounded = boundedStructureSummary(summary);
  const components = bounded.components || {};
  return {
    format: bounded.format || null,
    summaryLine: bounded.summaryLine || null,
    counts: bounded.counts || null,
    chains: components.chains || bounded.chains || null,
    ligands: components.ligands || bounded.ligands || null,
    waters: components.water || bounded.waters || null,
    ions: components.ions || bounded.ions || null,
    bounds: bounded.bounds || {},
  };
}

function inferApplied(ok, result) {
  if (!ok) return false;
  if (result && typeof result === "object" && result.ok === false) return false;
  return true;
}

function surfaceFromMode(mode) {
  if (mode === "desktop-app") return "desktop-app";
  if (mode === "browser-agent-shell" || mode === "browser-dev-shell") return "browser-agent-shell";
  if (mode === "browser-preview") return "browser-preview";
  return mode || "unknown";
}

function fileTitle(file) {
  return String(file || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "workspace";
}

async function resolveStructureSummaryTarget(input) {
  if (input.file) return { ok: true, file: input.file };
  if (!input.url && !input.sessionDir) {
    return {
      ok: false,
      error: { message: "Provide file, url, or sessionDir." },
    };
  }

  const args = ["observe"];
  if (input.url) args.push("--url", input.url);
  if (input.sessionDir) args.push("--session-dir", input.sessionDir);
  const result = await runBuretteAgent(args);
  const observe = result.payload?.result || null;
  const file = observe?.activeDocument?.path;
  if (!result.ok) {
    return {
      ok: false,
      observe,
      error: result.error || { message: "Observe failed." },
    };
  }
  if (!file) {
    return {
      ok: false,
      observe,
      error: { message: "No active document path is available in the observed workspace." },
    };
  }
  return { ok: true, file, observe };
}

async function resolveStructureComponentTarget(input) {
  if (input.file) return { ok: true, file: input.file };
  return resolveStructureSummaryTarget(input);
}

function structureComponentAction(input) {
  if (input.operation === "clear") {
    return { ok: true, value: { type: "clear_selection", label: "Clear selection" } };
  }
  const component = input.component || (input.chain ? "chain" : input.element ? "element" : input.compId ? "ligand" : "");
  if (!component) {
    return {
      ok: false,
      error: { message: "Provide component, chain, compId, or element." },
    };
  }
  const selector = componentSelector({
    component: component === "chain" ? "polymer" : component,
    chain: input.chain,
    compId: input.compId,
    seq: input.seq,
    element: input.element,
  });
  const label = structureComponentLabel({ component, chain: input.chain, compId: input.compId, seq: input.seq, element: input.element });

  if (input.operation === "focus") {
    return {
      ok: true,
      value: {
        type: "focus_ligand",
        label: `Focus ${label}`,
        selector,
        showNeighborhood: component === "ligand",
        radiusA: component === "ligand" ? 4 : undefined,
      },
    };
  }

  if (input.operation === "select") {
    return {
      ok: true,
      value: {
        type: "select_residues",
        label: `Select ${label}`,
        selector,
        granularity: "residue",
        mode: "replace",
      },
    };
  }

  if (input.operation === "hide" || input.operation === "show") {
    const kind = hideableComponentKind(component);
    if (!kind) {
      return {
        ok: false,
        error: { message: "hide/show supports polymer, ligand, ion, and water components." },
      };
    }
    if (kind === "water") {
      return {
        ok: true,
        value: {
          type: input.operation === "hide" ? "hide_waters" : "show_waters",
          label: `${input.operation === "hide" ? "Hide" : "Show"} water`,
        },
      };
    }
    return {
      ok: true,
      value: {
        type: input.operation === "hide" ? "hide_components" : "show_components",
        label: `${input.operation === "hide" ? "Hide" : "Show"} ${kind}`,
        kind,
      },
    };
  }

  return {
    ok: false,
    error: { message: "Unsupported structure component operation." },
  };
}

function selectionAction(input) {
  if (input.operation === "clear") return { type: "clear_selection" };
  const selector = input.selector || {};
  if (input.operation === "select") {
    return {
      type: "select_residues",
      selector,
      label: input.label,
      mode: input.mode || "replace",
      granularity: input.granularity || "residue",
    };
  }
  if (input.operation === "focus") {
    return {
      type: "focus_selection",
      args: {
        selector,
        durationMs: input.durationMs,
        extraRadius: input.extraRadius,
      },
    };
  }
  if (input.operation === "highlight") {
    return {
      type: "apply_scene",
      components: [
        {
          selector,
          label: input.label,
          highlight: true,
          color: input.color,
          mode: input.mode || "replace",
          granularity: input.granularity || "residue",
        },
      ],
    };
  }
  if (input.operation === "label") {
    return {
      type: "label_selection",
      selector,
      label: input.label,
      text: input.text || input.label,
      mode: input.mode,
      granularity: input.granularity,
    };
  }
  return { type: "clear_selection" };
}

function hideableComponentKind(component) {
  if (component === "chain" || component === "polymer") return "polymer";
  if (component === "ligand") return "ligand";
  if (component === "ion") return "ion";
  if (component === "water") return "water";
  return null;
}

function structureComponentLabel({ component, chain, compId, seq, element }) {
  return [
    component || "component",
    compId ? compId.toUpperCase() : null,
    chain ? `chain ${chain}` : null,
    seq !== undefined && seq !== null && String(seq).trim() ? `seq ${seq}` : null,
    element ? `element ${element}` : null,
  ].filter(Boolean).join(" ");
}

async function runWorkspaceAction({ url, sessionDir, action, waitMs }) {
  const args = ["act"];
  if (url) args.push("--url", url);
  if (sessionDir) args.push("--session-dir", sessionDir);
  args.push(JSON.stringify(action));
  args.push("--wait-ms", String(waitMs));
  return await runBuretteAgent(args, { timeoutMs: Math.max(30000, waitMs + 5000) });
}

async function safeStructureSummary(file) {
  try {
    return boundedStructureSummary(await summarizeStructureFile(file));
  } catch (error) {
    return {
      ok: false,
      path: file,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function cliToolResult(tool, result, extra = {}) {
  const error = boundedToolError(result.error);
  return {
    content: toolText(result.ok ? `${tool} completed.` : `${tool} failed: ${error?.message || "unknown error"}`),
    ...(result.ok ? {} : { isError: true }),
    structuredContent: {
      ok: result.ok,
      tool,
      result: result.payload?.result || null,
      ...extra,
      error: result.ok ? null : error,
      exitCode: result.exitCode,
    },
  };
}

function observedWorkspaceToolResult(tool, {
  started,
  result,
  observed,
  structureSummary = null,
  allowAwaitingBrowser = false,
}) {
  const rawObserve = observed.payload?.result || null;
  const readiness = workspaceReadiness(rawObserve);
  const ready = observed.ok && readiness.ready;
  const awaitingBrowser = allowAwaitingBrowser && workspaceOpenAwaitingBrowser(observed, ready);
  const error = ready ? null : boundedToolError(observed.error || viewerNotReadyError(readiness));
  return {
    content: toolText(awaitingBrowser
      ? `${tool} started. Open the returned workspace URL, then call observe_burette_workspace. Do not claim that the structure is visible until ready is true and the central canvas is visually verified.`
      : ready
      ? `${tool} completed: the molecular viewer is ready.`
      : `${tool} is not complete: ${error.message}`),
    ...(ready || awaitingBrowser ? {} : { isError: true }),
    structuredContent: {
      ok: ready || awaitingBrowser,
      tool,
      started,
      ready,
      completionState: ready ? "ready" : awaitingBrowser ? "awaiting_browser" : "not_ready",
      result,
      observe: boundedWorkspaceObserve(rawObserve),
      structureSummary,
      error: awaitingBrowser ? null : error,
      exitCode: observed.exitCode,
    },
  };
}

function workspaceOpenAwaitingBrowser(observed, ready) {
  if (ready) return false;
  if (observed.ok) return true;
  return observed.error?.code === "OBSERVE_UNAVAILABLE";
}

async function waitForWorkspaceDocumentReady({ url, sessionDir, path, waitMs }) {
  const deadline = Date.now() + Math.max(0, waitMs);
  let observed = null;
  let observe = null;
  let readiness = workspaceReadiness(null);
  do {
    observed = await observeWorkspaceSession({ url, sessionDir });
    observe = observed.payload?.result || null;
    readiness = workspaceReadiness(observe);
    if (observed.ok && observe?.activeDocument?.path === path && readiness.ready) {
      return {
        ok: true,
        observe,
        readiness,
        error: null,
        exitCode: observed.exitCode,
      };
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
  } while (Date.now() <= deadline);
  return {
    ok: false,
    observe,
    readiness,
    error: observed?.ok ? {
      code: "WORKSPACE_DOCUMENT_NOT_READY",
      message: `The file-open action completed, but the active Mol* document did not become ready at ${path}.`,
      details: {
        expectedPath: path,
        activePath: observe?.activeDocument?.path || null,
        readiness,
      },
    } : observed?.error || {
      code: "OBSERVE_FAILED",
      message: "The derived workspace could not be observed after opening the file.",
    },
    exitCode: observed?.exitCode ?? null,
  };
}

function boundedWorkspaceObserve(observe) {
  if (!observe || typeof observe !== "object" || Array.isArray(observe)) return observe || null;
  const budget = createObserveBudget();
  const source = { ...observe };
  delete source.bounds;
  const bounded = boundObserveValue(source, "", 0, budget);
  const payload = {
    ...bounded,
    bounds: budget.bounds,
  };
  if (JSON.stringify(payload).length <= OBSERVE_OUTPUT_LIMIT) return payload;
  return {
    apiVersion: bounded.apiVersion || null,
    mode: bounded.mode || null,
    transport: bounded.transport || null,
    reportedAt: bounded.reportedAt || null,
    activeDocument: bounded.activeDocument || null,
    viewerAgent: bounded.viewerAgent || null,
    scene: bounded.scene ? { known: bounded.scene.known === true } : null,
    errors: Array.isArray(bounded.errors) ? bounded.errors.slice(0, 10) : [],
    bounds: {
      payload: {
        truncated: true,
        reason: "max_output",
        limit: OBSERVE_OUTPUT_LIMIT,
      },
    },
  };
}

function boundedStructureSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return summary || null;
  const budget = createObserveBudget();
  const source = { ...summary };
  delete source.bounds;
  const bounded = boundObserveValue(source, "", 0, budget);
  const payload = {
    ...bounded,
    bounds: budget.bounds,
  };
  if (JSON.stringify(payload).length <= OBSERVE_OUTPUT_LIMIT) return payload;
  const components = bounded.components || {};
  return {
    ok: bounded.ok,
    path: bounded.path || null,
    title: bounded.title || null,
    extension: bounded.extension || null,
    byteCount: bounded.byteCount || null,
    lineCount: bounded.lineCount || null,
    format: bounded.format || null,
    kind: bounded.kind || null,
    summaryLine: bounded.summaryLine || null,
    counts: bounded.counts || null,
    components: {
      polymers: components.polymers || null,
      ligandTypes: Array.isArray(components.ligandTypes) ? components.ligandTypes.slice(0, 20) : [],
      ligands: Array.isArray(components.ligands) ? components.ligands.slice(0, 20) : [],
      chains: Array.isArray(components.chains) ? components.chains.slice(0, 20) : [],
      water: components.water || null,
      ions: Array.isArray(components.ions) ? components.ions.slice(0, 20) : [],
    },
    bounds: {
      payload: {
        truncated: true,
        reason: "max_output",
        limit: OBSERVE_OUTPUT_LIMIT,
      },
    },
  };
}

function createObserveBudget() {
  return {
    bounds: {},
    boundsRemaining: OBSERVE_BOUNDS_LIMIT,
    nodesRemaining: OBSERVE_NODE_LIMIT,
    stringCharactersRemaining: OBSERVE_TOTAL_STRING_LIMIT,
  };
}

function boundObserveValue(value, path, depth, budget) {
  if (budget.nodesRemaining <= 0) {
    recordObserveBound(budget, path, { truncated: true, reason: "node_budget" });
    return null;
  }
  budget.nodesRemaining -= 1;
  if (typeof value === "string") {
    const returnedCharacters = Math.min(value.length, OBSERVE_STRING_LIMIT, budget.stringCharactersRemaining);
    budget.stringCharactersRemaining -= returnedCharacters;
    if (returnedCharacters === value.length) return value;
    recordObserveBound(budget, path, {
      totalCharacters: value.length,
      returnedCharacters,
      truncated: true,
    });
    return value.slice(0, returnedCharacters);
  }
  if (Array.isArray(value)) {
    if (depth >= 8) {
      recordObserveBound(budget, path, { truncated: true, reason: "max_depth" });
      return [];
    }
    const output = [];
    const requested = Math.min(value.length, OBSERVE_ARRAY_LIMIT);
    for (let index = 0; index < requested && budget.nodesRemaining > 0; index += 1) {
      output.push(boundObserveValue(value[index], `${path}[${index}]`, depth + 1, budget));
    }
    if (output.length < value.length) {
      recordObserveBound(budget, path, {
        total: value.length,
        returned: output.length,
        truncated: true,
      });
    }
    return output;
  }
  if (!value || typeof value !== "object") return value;
  if (depth >= 8) {
    recordObserveBound(budget, path, { truncated: true, reason: "max_depth" });
    return null;
  }
  const entries = Object.entries(value);
  const output = {};
  const requestedEntries = entries.slice(0, OBSERVE_OBJECT_KEY_LIMIT);
  let returnedKeys = 0;
  for (const [rawKey, item] of requestedEntries) {
    if (budget.nodesRemaining <= 0) break;
    const key = rawKey.slice(0, OBSERVE_KEY_LIMIT);
    output[key] = boundObserveValue(item, path ? `${path}.${key}` : key, depth + 1, budget);
    returnedKeys += 1;
  }
  if (returnedKeys < entries.length) {
    recordObserveBound(budget, path, {
      totalKeys: entries.length,
      returnedKeys,
      truncated: true,
    });
  }
  return output;
}

function recordObserveBound(budget, path, value) {
  if (budget.boundsRemaining <= 0) return;
  budget.boundsRemaining -= 1;
  budget.bounds[String(path || "root").slice(0, 512)] = value;
}

function boundedToolError(error) {
  if (!error) return null;
  const source = typeof error === "string" ? { message: error } : error;
  const budget = createObserveBudget();
  const bounded = boundObserveValue(source, "error", 0, budget);
  if (!bounded || typeof bounded !== "object" || Array.isArray(bounded)) {
    return { message: String(bounded || "Unknown error") };
  }
  return Object.keys(budget.bounds).length > 0
    ? { ...bounded, bounds: budget.bounds }
    : bounded;
}

function workspaceReadiness(observe) {
  const activeDocument = observe?.activeDocument || null;
  const activeSurface = observe?.activeSurface || null;
  const chemicalEditor = observe?.chemicalEditor || null;
  if (activeSurface?.kind === "ketcher") {
    const editorReady = activeSurface.ready === true && chemicalEditor?.phase === "ready";
    return {
      ready: editorReady,
      documentReady: editorReady,
      requiresViewerAgent: false,
      requiresKetcherAgent: true,
      agentAvailable: editorReady,
      agentReady: editorReady,
      viewerReady: editorReady,
      lastError: null,
    };
  }
  const viewerAgent = observe?.viewerAgent || null;
  const renderer = String(activeDocument?.renderer || activeDocument?.viewer || "").toLowerCase();
  const requiresViewerAgent = renderer.includes("molstar");
  const documentReady = activeDocument?.ready === true;
  const agentAvailable = viewerAgent?.available === true;
  const agentReady = viewerAgent && Object.hasOwn(viewerAgent, "ready")
    ? viewerAgent.ready === true
    : agentAvailable;
  const viewerReady = viewerAgent && Object.hasOwn(viewerAgent, "viewerReady")
    ? viewerAgent.viewerReady === true
    : agentAvailable;
  const runtimeReady = !requiresViewerAgent || (agentAvailable && agentReady && viewerReady);
  return {
    ready: documentReady && runtimeReady,
    documentReady,
    requiresViewerAgent,
    agentAvailable,
    agentReady,
    viewerReady,
    lastError: boundedToolError(viewerAgent?.lastError || null),
  };
}

function viewerNotReadyError(readiness) {
  return {
    code: "VIEWER_NOT_READY",
    message: "The Burette workspace started, but the active molecular viewer is not ready. Do not claim that the structure is visible; open the workspace URL, observe it again, and visually verify the central canvas.",
    details: readiness,
  };
}
