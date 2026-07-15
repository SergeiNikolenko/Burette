---
name: external-agent-contract
description: "Use when an external agent must open, observe, control, or render into a Burrete molecular workspace without managing transport details."
---

# External Agent Contract

Use this workflow when an external assistant needs to operate Burrete but does
not need to choose Browser preview, Browser shell, desktop app, URL, or session
directory details directly.

## Contract

Prefer these short tools before advanced Burrete tools:

- `burrete.get_context`: discover capabilities, supported formats, and known
  sessions.
- `burrete.open_workspace`: open a molecular artifact and receive a
  `workspaceSessionId`.
- `burrete.open_ketcher`: open the Ketcher chemical editor as the active
  workspace surface.
- `burrete.observe_workspace`: refresh compact model context for a session.
- `burrete.control_viewer`: run one allowlisted viewer action against the
  session and receive refreshed model context.
- `burrete.control_ketcher`: apply one revision-checked Ketcher action to the
  active chemical editor.
- `burrete.render_panel`: render markdown, table, or chart content into a
  workspace dock.

`workspaceSessionId` is the external handle. `viewerSessionId` is returned as a
compatibility alias for viewer-style workflows. Do not make downstream agents
carry `url`, `sessionDir`, or transport mode unless attaching to a workspace
that was opened before this contract existed.

## Workflow

1. Call `burrete.get_context` if the available sessions or capabilities are not
   already known.
2. Call `burrete.open_workspace` with the exact local file path. Use default
   `mode: "auto"` unless the user explicitly asks for the real desktop app or
   a specific Browser surface.
3. Keep the returned `workspaceSessionId`. A successful open can return
   `ok: true`, `ready: false`, and `completionState: "awaiting_browser"`; this
   means the transport started correctly, not that the structure is visible.
   Open the returned URL before continuing.
4. After the Browser URL is open, call `burrete.observe_workspace`. Continue
   only when it returns `ready: true`; treat `completionState: "not_ready"` or
   `VIEWER_NOT_READY` as a failed visualization and never claim the structure
   is visible from file names or molecular counts alone.
5. For scene changes, call `burrete.control_viewer` with the same
   `workspaceSessionId` and a serializable Burrete action such as
   `reset_camera`, `focus_ligand`, `select_residues`, `apply_scene`, or
   `set_molstar_style`.
6. For chemical editing, call `burrete.open_ketcher`, then observe the returned
   `modelContext.activeSurface` and `modelContext.chemicalEditor`. Send
   `burrete.control_ketcher` actions with the returned `surfaceId` and
   `structureRevision` as `expectedRevision`. Refresh the observation after
   every mutation; never reuse a revision after a conflict or tab switch.
7. For adjacent notes or review panels, call `burrete.render_panel`.

## Boundaries

- Do not read molecular file bytes merely to open the viewer.
- Do not treat screenshots as molecular truth when `modelContext` or typed
  observe/action output is available.
- Do not claim an action changed the viewer when the tool returns
  `applied: false` or `ok: false`.
- Do not claim a Ketcher edit was persisted when `request_persist` returns
  `status: "awaiting_user"`; a user confirmation and a separate save operation
  are required.
- Do not treat `completionState: "awaiting_browser"` as completed rendering.
- Use advanced tools only when the short contract is missing a capability, such
  as docking-specific setup, fragment extraction, trajectory review, or bounded
  molecular report validation.
