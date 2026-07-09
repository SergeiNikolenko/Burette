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
- `burrete.observe_workspace`: refresh compact model context for a session.
- `burrete.control_viewer`: run one allowlisted viewer action against the
  session and receive refreshed model context.
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
3. Keep the returned `workspaceSessionId`.
4. For follow-up questions about current scene state, call
   `burrete.observe_workspace` and answer from `modelContext`.
5. For scene changes, call `burrete.control_viewer` with the same
   `workspaceSessionId` and a serializable Burrete action such as
   `reset_camera`, `focus_ligand`, `select_residues`, `apply_scene`, or
   `set_molstar_style`.
6. For adjacent notes or review panels, call `burrete.render_panel`.

## Boundaries

- Do not read molecular file bytes merely to open the viewer.
- Do not treat screenshots as molecular truth when `modelContext` or typed
  observe/action output is available.
- Do not claim an action changed the viewer when the tool returns
  `applied: false` or `ok: false`.
- Use advanced tools only when the short contract is missing a capability, such
  as docking-specific setup, fragment extraction, trajectory review, or bounded
  molecular report validation.
