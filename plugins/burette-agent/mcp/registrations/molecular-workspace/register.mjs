import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { runBurreteAgent } from "../../lib/cli-bridge.mjs";
import {
  createWorkspaceSession,
  listWorkspaceSessions,
  resolveWorkspaceSession,
  updateWorkspaceSession,
} from "../../lib/session-registry.mjs";
import { componentSelector, editStructureFragmentFile, extractStructureComponentFile } from "../../lib/structure-components.mjs";
import { summarizeStructureFile } from "../../lib/structure-summary.mjs";
import { registerWidgetResource, toolText, widgetHtml } from "../../lib/widget-resource.mjs";

const actionSchema = z.object({ type: z.string().trim().min(1) }).passthrough();
const externalActionSchema = z.object({ type: z.string().trim().min(1) }).passthrough();
const WORKSPACE_WIDGET_URI = "ui://widget/burette-agent/molecular-workspace-20260624.html";
const PUBLIC_CONTRACT = {
  apiVersion: "burrete-external-agent/v1",
  tools: [
    "burrete.get_context",
    "burrete.open_workspace",
    "burrete.observe_workspace",
    "burrete.control_viewer",
    "burrete.render_panel",
  ],
  advancedTools: [
    "open_burrete_workspace",
    "observe_burrete_workspace",
    "act_molstar_scene",
    "manage_burrete_tabs",
    "manage_burrete_structure_component",
    "open_burrete_docking_view",
    "summarize_burrete_structure",
  ],
  supportedFormats: ["pdb", "cif", "mmcif", "mol", "sdf", "xyz", "mae", "maegz"],
  capabilities: {
    canOpenWorkspace: true,
    canObserveWorkspace: true,
    canControlMolstar: true,
    canRenderPanels: true,
    canUseBrowserShell: true,
    canUseBrowserPreview: true,
    canUseDesktopApp: true,
  },
};

export function registerMolecularWorkspace(server) {
  registerWidgetResource(server, {
    name: "burette-molecular-workspace-widget",
    uri: WORKSPACE_WIDGET_URI,
    title: "Burrete Molecular Workspace",
    description: "An interactive Burrete workspace preview with compact observe state.",
    html: widgetHtml("molecular-workspace"),
    resourceDomains: ["data:", "blob:", "http://127.0.0.1:*", "http://localhost:*"],
    connectDomains: ["http://127.0.0.1:*", "http://localhost:*"],
  });

  registerAppTool(
    server,
    "burrete.get_context",
    {
      title: "Get Burrete Agent Context",
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
        return publicContractResult("burrete.get_context", {
          ok: true,
          session: null,
          observe: null,
          result: {
            sessions: listWorkspaceSessions(),
          },
        });
      }
      const resolved = resolveWorkspaceSession(input);
      if (!resolved.ok) return publicContractFailure("burrete.get_context", resolved.error);
      const observed = await observeWorkspaceSession(resolved.session);
      const session = updateKnownSession(resolved.session, {
        observe: observed.payload?.result || null,
      });
      return publicContractResult("burrete.get_context", {
        ok: observed.ok,
        session,
        observe: observed.payload?.result || null,
        result: {
          sessions: listWorkspaceSessions(),
        },
        error: observed.ok ? null : observed.error,
        exitCode: observed.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burrete.open_workspace",
    {
      title: "Open Burrete Workspace",
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
      const result = await runBurreteAgent(args, { timeoutMs: 45000 });
      if (!result.ok) {
        return publicContractFailure("burrete.open_workspace", result.error, {
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
      const session = updateWorkspaceSession(provisionalSession.workspaceSessionId, {
        observe: observed.payload?.result || null,
      }) || provisionalSession;
      return publicContractResult("burrete.open_workspace", {
        ok: result.ok,
        session,
        observe: observed.payload?.result || null,
        result: openResult,
        structureSummary,
        error: observed.ok ? null : observed.error,
        exitCode: result.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burrete.observe_workspace",
    {
      title: "Observe Burrete Workspace",
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
      if (!resolved.ok) return publicContractFailure("burrete.observe_workspace", resolved.error);
      const observed = await observeWorkspaceSession(resolved.session);
      const session = updateKnownSession(resolved.session, {
        observe: observed.payload?.result || null,
      });
      return publicContractResult("burrete.observe_workspace", {
        ok: observed.ok,
        session,
        observe: observed.payload?.result || null,
        result: observed.payload?.result || null,
        error: observed.ok ? null : observed.error,
        exitCode: observed.exitCode,
      });
    },
  );

  registerAppTool(
    server,
    "burrete.control_viewer",
    {
      title: "Control Burrete Viewer",
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
      if (!resolved.ok) return publicContractFailure("burrete.control_viewer", resolved.error);
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
      return publicContractResult("burrete.control_viewer", {
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
    "burrete.render_panel",
    {
      title: "Render Burrete Panel",
      description: "Render a markdown, table, or chart file into a Burrete workspace dock through the short external-agent contract.",
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
      if (!resolved.ok) return publicContractFailure("burrete.render_panel", resolved.error);
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
      return publicContractResult("burrete.render_panel", {
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
    "open_burrete_workspace",
    {
      title: "Open Burrete Workspace",
      description: "Open a local molecular artifact in the full Browser shell, Browser preview, or the real Burrete desktop app through the repository CLI.",
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
      const result = await runBurreteAgent(args, { timeoutMs: 45000 });
      const structureSummary = await safeStructureSummary(input.file);
      return cliToolResult("open_burrete_workspace", result, { structureSummary });
    },
  );

  registerAppTool(
    server,
    "summarize_burrete_structure",
    {
      title: "Summarize Burrete Structure",
      description: "Read a local molecular file, or the active Burrete workspace document, and return an Info-panel-style structured summary for agent planning.",
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
          content: toolText(`summarize_burrete_structure failed: ${resolved.error.message}`),
          structuredContent: {
            ok: false,
            tool: "summarize_burrete_structure",
            summary: null,
            observe: resolved.observe || null,
            error: resolved.error,
          },
        };
      }
      const summary = await summarizeStructureFile(resolved.file);
      return {
        content: toolText(`summarize_burrete_structure completed: ${summary.summaryLine}`),
        structuredContent: {
          ok: true,
          tool: "summarize_burrete_structure",
          summary,
          observe: resolved.observe || null,
          error: null,
        },
      };
    },
  );

  registerAppTool(
    server,
    "observe_burrete_workspace",
    {
      title: "Observe Burrete Workspace",
      description: "Read structured Burrete workspace state from a tokenized Browser preview URL or desktop session directory.",
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
      const result = await runBurreteAgent(args);
      const observe = result.payload?.result || null;
      return {
        content: toolText(result.ok ? "Observed Burrete workspace." : `Observe failed: ${result.error?.message || "unknown error"}`),
        structuredContent: {
          ok: result.ok,
          tool: "observe_burrete_workspace",
          observe,
          error: result.ok ? null : result.error,
        },
      };
    },
  );

  registerAppTool(
    server,
    "render_molecular_workspace_widget",
    {
      title: "Render Molecular Workspace Widget",
      description: "Render an interactive inline Burrete workspace preview backed by a local Browser shell or preview URL.",
      inputSchema: {
        title: z.string().trim().optional(),
        summary: z.string().trim().optional(),
        url: z.string().trim().optional(),
        sessionDir: z.string().trim().optional(),
        observe: z.record(z.unknown()).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: WORKSPACE_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": WORKSPACE_WIDGET_URI,
        "openai/widgetAccessible": true,
      },
    },
    async input => {
      const previewUrl = safeLocalWorkspaceUrl(input.url);
      const observe = input.observe || null;
      const activeDocument = observe?.activeDocument || null;
      const title = input.title || activeDocument?.title || "Molecular Workspace";
      const widgetData = {
        version: 1,
        title,
        summary: input.summary || workspaceWidgetSummary({ observe, previewUrl }),
        previewUrl,
        sessionDir: input.sessionDir || null,
        observe,
      };
      return {
        content: toolText(previewUrl ? "Rendered interactive molecular workspace widget." : "Rendered molecular workspace status widget without a local preview URL."),
        structuredContent: {
          ok: true,
          tool: "render_molecular_workspace_widget",
          widget: "molecular-workspace",
          title,
          interactive: Boolean(previewUrl),
          activeDocument,
          viewerReady: Boolean(observe?.activeDocument?.ready || observe?.viewerAgent?.ready || observe?.viewer?.ready),
        },
        _meta: {
          "openai/outputTemplate": WORKSPACE_WIDGET_URI,
          widgetData,
        },
      };
    },
  );

  registerAppTool(
    server,
    "manage_burrete_tabs",
    {
      title: "Manage Burrete Tabs",
      description: "List, focus, open, close, and move tabs inside the active Burrete Browser shell or desktop workspace.",
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
        const result = await runBurreteAgent(args);
        return cliToolResult("manage_burrete_tabs", result, {
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
      const result = await runBurreteAgent(args, { timeoutMs: Math.max(30000, waitMs + 5000) });
      return cliToolResult("manage_burrete_tabs", result);
    },
  );

  registerAppTool(
    server,
    "manage_burrete_structure_component",
    {
      title: "Manage Burrete Structure Component",
      description: "Select, focus, hide, show, clear, or open a chain/ligand/water/ion/polymer/element from the active Burrete structure as its own tab.",
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
          content: toolText(`manage_burrete_structure_component failed: ${resolved.error.message}`),
          structuredContent: {
            ok: false,
            tool: "manage_burrete_structure_component",
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
        return cliToolResult("manage_burrete_structure_component", result, { extracted });
      }

      const action = structureComponentAction(input);
      if (!action.ok) {
        return {
          content: toolText(`manage_burrete_structure_component failed: ${action.error.message}`),
          structuredContent: {
            ok: false,
            tool: "manage_burrete_structure_component",
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
      return cliToolResult("manage_burrete_structure_component", result, {
        selector: action.value.selector || null,
      });
    },
  );

  registerAppTool(
    server,
    "open_burrete_docking_view",
    {
      title: "Open Burrete Docking View",
      description: "Open a Mol* docking or combined structure-scene view inside the active Burrete Browser shell or desktop workspace.",
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
      return cliToolResult("open_burrete_docking_view", result);
    },
  );

  registerAppTool(
    server,
    "set_burrete_trajectory",
    {
      title: "Set Burrete Trajectory",
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
      return cliToolResult("set_burrete_trajectory", result, {
        results: results.map((item) => item.payload?.result || item.error || null),
        actionType,
      });
    },
  );

  registerAppTool(
    server,
    "set_burrete_representation_style",
    {
      title: "Set Burrete Representation Style",
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
      return cliToolResult("set_burrete_representation_style", result, { style: input.style });
    },
  );

  registerAppTool(
    server,
    "focus_burrete_selection",
    {
      title: "Focus Burrete Selection",
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
      return cliToolResult("focus_burrete_selection", result, { action });
    },
  );

  registerAppTool(
    server,
    "edit_burrete_fragment",
    {
      title: "Edit Burrete Fragment",
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
      }
      return {
        content: toolText(`edit_burrete_fragment completed: ${edited.outputPath}`),
        structuredContent: {
          ok: true,
          tool: "edit_burrete_fragment",
          edited,
          opened: opened?.payload?.result || null,
          error: null,
          exitCode: opened?.exitCode ?? null,
        },
      };
    },
  );

  registerAppTool(
    server,
    "act_molstar_scene",
    {
      title: "Act On Molstar Scene",
      description: "Queue an allowlisted high-level or declarative Mol* scene action through the Burrete agent contract.",
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
      const result = await runBurreteAgent(args, { timeoutMs: Math.max(30000, (input.waitMs || 0) + 5000) });
      return cliToolResult("act_molstar_scene", result);
    },
  );

}

function safeLocalWorkspaceUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return null;
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function workspaceWidgetSummary({ observe, previewUrl }) {
  const activeDocument = observe?.activeDocument;
  if (activeDocument?.title) {
    const ready = activeDocument.ready ? "ready" : "loading";
    return `${activeDocument.title} (${ready})`;
  }
  if (previewUrl) return "Interactive Burrete workspace preview.";
  return "No local workspace preview URL supplied.";
}

async function observeWorkspaceSession(session) {
  const args = ["observe"];
  const locator = workspaceLocatorArgs(session);
  if (!locator.ok) return missingWorkspaceLocatorResult(locator.error);
  args.push(...locator.args);
  return await runBurreteAgent(args);
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

function publicContractResult(tool, {
  ok,
  session = null,
  observe = null,
  result = null,
  structureSummary = null,
  action = null,
  applied = null,
  error = null,
  exitCode = null,
}) {
  const modelContext = buildModelContext({ session, observe, structureSummary: structureSummary || session?.structureSummary || null });
  return {
    content: toolText(ok ? `${tool} completed.` : `${tool} failed: ${error?.message || "unknown error"}`),
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
      observe,
      sessions: result?.sessions || undefined,
      error: ok ? null : error,
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
  return {
    format: summary.format || null,
    summaryLine: summary.summaryLine || null,
    counts: summary.counts || null,
    chains: summary.chains || null,
    ligands: summary.ligands || null,
    waters: summary.waters || null,
    ions: summary.ions || null,
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
  const result = await runBurreteAgent(args);
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
  return await runBurreteAgent(args, { timeoutMs: Math.max(30000, waitMs + 5000) });
}

async function safeStructureSummary(file) {
  try {
    return await summarizeStructureFile(file);
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
  return {
    content: toolText(result.ok ? `${tool} completed.` : `${tool} failed: ${result.error?.message || "unknown error"}`),
    structuredContent: {
      ok: result.ok,
      tool,
      result: result.payload?.result || null,
      ...extra,
      error: result.ok ? null : result.error,
      exitCode: result.exitCode,
    },
  };
}
