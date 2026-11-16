import type { App } from "@modelcontextprotocol/ext-apps";

type ToolResult = Awaited<ReturnType<App["callServerTool"]>>;
type CallServerTool = (name: string, arguments_: Record<string, unknown>) => Promise<ToolResult>;
type UnknownRecord = Record<string, unknown>;

/** Start-page operations, shaped like the native widget's home bridge. */
export type HostedWorkspaceHome = {
  open: (link: string) => Promise<void>;
  search: (query: string) => Promise<never[]>;
  recent: () => Promise<Array<{ path: string; label: string; format: string; openedAt: string }>>;
  ask: (text: string) => Promise<void>;
};

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const SKETCH_FORMATS: Record<string, string> = { mol: "mol", smi: "smiles", smiles: "smiles", ket: "ket", rxn: "rxn" };
const RECENT_KEY = "burette-cloud-recent-pdb";
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;

const record = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? value as UnknownRecord : null;

// Results the widget fetches itself reach the shell the way host results do.
function deliverToolResult(result: unknown) {
  window.dispatchEvent(new MessageEvent("message", {
    data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result },
    source: window.parent,
  }));
}

function recentPdbEntries(): Array<{ id: string; openedAt: string }> {
  try {
    const entries = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(entries)
      ? entries.filter((entry) => PDB_ID.test(entry?.id) && typeof entry.openedAt === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberPdbEntry(result: unknown) {
  const source = record(record(record(result)?._meta)?.scene)?.source;
  const id = record(source)?.kind === "pdb" ? String(record(source)?.pdbId ?? "").toUpperCase() : "";
  if (!PDB_ID.test(id)) return;
  const entries = [{ id, openedAt: new Date().toISOString() }, ...recentPdbEntries().filter((entry) => entry.id !== id)];
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, 8)));
  } catch {
    // Storage can be unavailable in the host sandbox; the list stays empty.
  }
}

/**
 * Handles the Codex entrypoints: a file the user opened in Burette, and the
 * empty workspace beside the conversation with its start page.
 */
export function installHostedWorkspace(app: App, callServerTool: CallServerTool, showHome: (home: HostedWorkspaceHome) => void) {
  // The host reads the opened file itself; the server never sees its path.
  async function readHostFile(resourceUri: string) {
    const result = await app.readServerResource({
      uri: resourceUri,
      _meta: { "openai/resource": { representation: "text" } },
    });
    const item = result.contents[0];
    const text = item && "text" in item ? item.text
      : item && "blob" in item ? new TextDecoder().decode(Uint8Array.from(atob(item.blob), (char) => char.charCodeAt(0)))
        : null;
    if (text === null) throw new Error("The file is empty.");
    if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new Error("The file is larger than 3 MB.");
    return text;
  }

  async function openHostFile(file: { name: string; resourceUri: string }) {
    try {
      const content = await readHostFile(file.resourceUri);
      const sketch = SKETCH_FORMATS[file.name.split(".").pop()?.toLowerCase() ?? ""];
      deliverToolResult(sketch
        ? await callServerTool("open_molecular_editor", { structure: { format: sketch, content } })
        : await callServerTool("prepare_structure_content", { fileName: file.name, content }));
    } catch (error) {
      deliverToolResult({
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "Burette could not open this file." }],
      });
    }
  }

  const home: HostedWorkspaceHome = {
    async open(link) {
      const url = new URL(link, "https://burette.invalid");
      const path = url.searchParams.get("path") ?? url.pathname;
      const id = /([0-9][A-Za-z0-9]{3})(?:\.pdb)?$/u.exec(path)?.[1];
      if (!id) throw new Error("Unsupported Burette link.");
      const result = await callServerTool("preview_pdb_structure", { pdbId: id });
      if (result.isError) throw new Error("Burette could not open this entry.");
      rememberPdbEntry(result);
      deliverToolResult(result);
    },
    async search() {
      return [];
    },
    async recent() {
      return recentPdbEntries().map(({ id, openedAt }) => ({ path: `${id}.pdb`, label: id, format: "pdb", openedAt }));
    },
    async ask(text) {
      await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    },
  };

  // Codex opens a file entrypoint with { file: { name, resourceUri } }.
  app.ontoolinput = ({ arguments: args }) => {
    const file = record(args?.file);
    if (typeof file?.name === "string" && typeof file.resourceUri === "string") {
      void openHostFile({ name: file.name, resourceUri: file.resourceUri });
    }
  };

  app.ontoolresult = (result) => {
    rememberPdbEntry(result);
    const entrypoint = record(record(result._meta)?.workspace)?.entrypoint;
    if (entrypoint === "thread" || entrypoint === "global") showHome(home);
  };
}
