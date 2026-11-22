import type { App } from "@modelcontextprotocol/ext-apps";

type ToolResult = Awaited<ReturnType<App["callServerTool"]>>;
type CallServerTool = (name: string, arguments_: Record<string, unknown>) => Promise<ToolResult>;
type UnknownRecord = Record<string, unknown>;

/** Start-page operations, shaped like the native widget's home bridge. */
export type HostedWorkspaceHome = {
  open: (link: string) => Promise<void>;
  search: (query: string) => Promise<Array<{ uri: string; name: string; title?: string; description?: string }>>;
  recent: () => Promise<Array<{ path: string; label: string; format: string; openedAt: string }>>;
  ask: (text: string) => Promise<void>;
  featured?: ReadonlyArray<{ uri: string; name: string; title?: string; description?: string }>;
  searchPlaceholder?: string;
};

type HostedEntrypoint = "global" | "thread" | "file";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const SKETCH_FORMATS: Record<string, string> = { mol: "mol", smi: "smiles", smiles: "smiles", ket: "ket", rxn: "rxn" };
const RECENT_KEY = "burette-cloud-recent-pdb";
const PDB_ID = /^[0-9][A-Z0-9]{3}$/u;
const FEATURED_STRUCTURES: ReadonlyArray<{ uri: string; name: string; title?: string; description?: string }> = [
  { uri: "https://www.rcsb.org/structure/1CRN", name: "1CRN", title: "1CRN · Crambin", description: "46-residue plant protein, crisp X-ray structure" },
  { uri: "https://www.rcsb.org/structure/1STP", name: "1STP", title: "1STP · Streptavidin–biotin", description: "Protein–ligand complex with bound biotin" },
  { uri: "https://www.rcsb.org/structure/1HTB", name: "1HTB", title: "1HTB · Alcohol dehydrogenase", description: "Enzyme complex with NAD cofactor and zinc ions" },
  { uri: "https://www.rcsb.org/structure/6LU7", name: "6LU7", title: "6LU7 · SARS-CoV-2 Mpro", description: "Main protease with covalent inhibitor N3" },
];

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
  const res = record(result);
  const meta = record(res?._meta) ?? record(record(res?.structuredContent)?._meta);
  const source = record(record(meta?.scene))?.source;
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
export function installHostedWorkspace(
  app: App,
  callServerTool: CallServerTool,
  showHome: (home: HostedWorkspaceHome, entrypoint?: HostedEntrypoint) => void,
) {
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
    featured: FEATURED_STRUCTURES,
    searchPlaceholder: "Search Protein Data Bank or enter a PDB ID (e.g. 1CRN, insulin)…",
    async open(link) {
      const trimmed = link.trim();
      let id: string | undefined;
      if (/^[0-9][A-Za-z0-9]{3}$/u.test(trimmed)) {
        id = trimmed.toUpperCase();
      } else {
        const url = new URL(trimmed, "https://burette.invalid");
        const path = url.searchParams.get("path") ?? url.pathname;
        id = /([0-9][A-Za-z0-9]{3})(?:\.pdb)?$/u.exec(path)?.[1]?.toUpperCase();
      }
      if (!id) throw new Error("Unsupported Burette link.");
      const result = await callServerTool("preview_pdb_structure", { pdbId: id });
      if (result.isError) throw new Error("Burette could not open this entry.");
      rememberPdbEntry(result);
      deliverToolResult(result);
    },
    async search(query) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const result = await callServerTool("search_pdb_mentions", { query: trimmed });
      if (result.isError) return [];
      const structured = record(result.structuredContent);
      const rawItems = Array.isArray(structured?.items) ? structured.items : [];
      return rawItems
        .map((item) => record(item))
        .filter((item): item is UnknownRecord => (
          item !== null && typeof item.uri === "string" && typeof item.name === "string"
        ))
        .slice(0, 8)
        .map((item) => ({
          uri: String(item.uri),
          name: String(item.name),
          ...(typeof item.title === "string" ? { title: item.title } : {}),
          ...(typeof item.description === "string" ? { description: item.description } : {}),
        }));
    },
    async recent() {
      return recentPdbEntries().map(({ id, openedAt }) => ({ path: `${id}.pdb`, label: id, format: "pdb", openedAt }));
    },
    async ask(text) {
      await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    },
  };

  function inspectWorkspaceResult(value: unknown) {
    const res = record(value);
    if (!res) return;
    rememberPdbEntry(res);
    const structured = record(res.structuredContent);
    const meta = record(res._meta) ?? record(structured?._meta);
    const rawEntrypoint = record(meta?.workspace)?.entrypoint
      ?? structured?.entrypoint
      ?? record(structured?.structuredContent)?.entrypoint;
    const entrypoint: HostedEntrypoint | undefined = rawEntrypoint === "global"
      || rawEntrypoint === "thread"
      || rawEntrypoint === "file"
      ? rawEntrypoint
      : undefined;
    if (entrypoint) document.documentElement.dataset.hostedEntrypoint = entrypoint;
    if (entrypoint === "thread" || entrypoint === "global") showHome(home, entrypoint);
  }

  // Codex opens a file entrypoint with { file: { name, resourceUri } }.
  app.ontoolinput = ({ arguments: args }) => {
    const file = record(args?.file);
    if (typeof file?.name === "string" && typeof file.resourceUri === "string") {
      void openHostFile({ name: file.name, resourceUri: file.resourceUri });
    }
  };

  app.ontoolresult = (result) => {
    inspectWorkspaceResult(result);
  };

  window.addEventListener("openai:set_globals", (event) => {
    const globals = (event as CustomEvent<{ globals?: { toolOutput?: unknown; toolResponseMetadata?: unknown } }>).detail?.globals;
    if (!globals) return;
    inspectWorkspaceResult({ structuredContent: globals.toolOutput, _meta: globals.toolResponseMetadata });
  }, { passive: true });

  const openAi = (window as Window & { openai?: { toolOutput?: unknown; toolResponseMetadata?: unknown } }).openai;
  if (openAi?.toolOutput !== undefined || openAi?.toolResponseMetadata !== undefined) {
    inspectWorkspaceResult({
      structuredContent: openAi.toolOutput,
      _meta: openAi.toolResponseMetadata,
    });
  }
  const queued = (window as Window & { __BURETTE_HOSTED_MCP_RESULTS__?: unknown[] }).__BURETTE_HOSTED_MCP_RESULTS__;
  if (Array.isArray(queued)) {
    for (const item of queued) inspectWorkspaceResult(item);
  }
}
