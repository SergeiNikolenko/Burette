# Custom MCP Spec

## Summary

Allow Writer to host or connect to Model Context Protocol (MCP) servers so the user can extend the editor with custom tools — for example, a "summarize selection" command, a "create note from web page" command, or per-workspace agents.

## Goals

- Add an MCP client inside Writer that can connect to user-configured MCP servers.
- Surface MCP-provided tools and prompts in a dedicated command surface.
- Let workspace tools act on the current selection, the active document, or the workspace as a whole.
- Configuration is per-user with optional per-workspace overrides.

## Non-Goals

- Building MCP servers; Writer is a client only in v1.
- A full agent loop with autonomous multi-step planning.
- Cloud sync of MCP configuration.

## UX Decisions

### Configuration

- Add an `MCP Servers` settings page (or settings file at `~/.writer/mcp.json` for v1 simplicity).
- Each server entry: name, transport (stdio | sse | http), command/url, env, optional workspace scope.
- Reload servers when configuration changes.

### Invocation surfaces

- A new `Tools` palette (e.g., `Cmd+Shift+P`) lists available tools across connected servers.
- Each tool can declare an input schema; Writer renders a small form when invoked.
- Output renders in a side panel or as a new note in the workspace, depending on the tool's declared output kind.

### Selection-aware tools

- Tools can opt into receiving the current document, current selection, or current cursor context as input.
- The user must explicitly approve sending any document content the first time a server is contacted.

## Security

- Servers run with the user's privileges. Show a clear "this server can read your documents" warning on first connect.
- Default deny for any server attempting to write files; require explicit per-server allow.
- Never auto-run tools without user invocation.

## Implementation Notes

- Use a small Rust MCP client crate (or implement the JSON-RPC protocol over stdio in `apps/desktop/src-tauri/src/mcp/`).
- Expose Rust commands `mcp_list_servers`, `mcp_list_tools`, `mcp_invoke_tool`, `mcp_reload_config`.
- Frontend gets a `useMcp` hook and a tools palette component.
- Persist trust decisions per server in `~/.writer/mcp-trust.json`.

## Files Expected To Change

- `apps/desktop/src-tauri/Cargo.toml`
- new `apps/desktop/src-tauri/src/mcp/` module
- `apps/desktop/src-tauri/src/lib.rs`
- new `apps/desktop/src/components/tools-palette.tsx`
- new `apps/desktop/src/hooks/use-mcp.ts`
- frontend and Rust tests

## Acceptance Criteria

- The user can configure one or more MCP servers and Writer connects to them on launch.
- The user can list available tools and invoke one against the current document or selection.
- Tool output renders in the editor in a clearly attributed way.
- Connecting to a server prompts for trust on first use; refusing trust prevents data from being sent.
