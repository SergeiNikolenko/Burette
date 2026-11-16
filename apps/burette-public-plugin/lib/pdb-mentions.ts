// Composer at-mentions (OpenAI MCP Extensions): the user types @Burette and a
// query, and picks PDB entries as resource links. The model opens a picked
// entry with preview_pdb_structure. Both RCSB endpoints are fixed public hosts.
const MAX_ITEMS = 8;
const SUGGESTIONS = ["1HTB", "4HHB", "1STP", "6LU7"];
const PDB_ID = /^[0-9][A-Za-z0-9]{3}$/u;
// Titles never change, and the composer asks again on every keystroke.
const knownTitles = new Map<string, string>();

export type PdbMention = {
  type: "resource_link";
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: "text/html";
};

// Short budgets keep the composer responsive when RCSB is slow or offline.
async function rcsb(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`RCSB returned HTTP ${response.status}.`);
  return response.json();
}

async function searchIds(query: string): Promise<string[]> {
  if (!query) return SUGGESTIONS;
  if (PDB_ID.test(query)) return [query.toUpperCase()];
  const found = await rcsb("https://search.rcsb.org/rcsbsearch/v2/query", {
    query: { type: "terminal", service: "full_text", parameters: { value: query } },
    return_type: "entry",
    request_options: { paginate: { start: 0, rows: MAX_ITEMS } },
  }, 2500) as { result_set?: Array<{ identifier?: unknown }> } | null;
  return (found?.result_set ?? []).map((item) => String(item.identifier ?? "")).filter((id) => PDB_ID.test(id));
}

// Null when RCSB is unreachable: the IDs are then offered untitled.
async function titles(ids: string[]): Promise<Map<string, string> | null> {
  const missing = ids.filter((id) => !knownTitles.has(id));
  if (missing.length) {
    const found = await rcsb("https://data.rcsb.org/graphql", {
      query: `{entries(entry_ids:${JSON.stringify(missing)}){rcsb_id struct{title}}}`,
    }, 1500).catch(() => null) as { data?: { entries?: Array<{ rcsb_id: string; struct?: { title?: string } } | null> } } | null;
    if (!found?.data) return null;
    for (const entry of found.data.entries ?? []) {
      if (entry) knownTitles.set(entry.rcsb_id, entry.struct?.title ?? "");
    }
  }
  return knownTitles;
}

export async function searchPdbMentions(query: string): Promise<PdbMention[]> {
  const ids = (await searchIds(query.trim())).slice(0, MAX_ITEMS);
  if (!ids.length) return [];
  const named = await titles(ids);
  // An exact ID RCSB does not know is not offered.
  return ids.filter((id) => !named || named.has(id)).map((id) => {
    const title = named?.get(id)?.replace(/\s+/gu, " ").trim().slice(0, 120);
    return {
      type: "resource_link",
      uri: `https://www.rcsb.org/structure/${id}`,
      name: id,
      title: title ? `${id} · ${title}` : id,
      description: `PDB entry ${id}. Open it in Burette with preview_pdb_structure and pdbId "${id}".`,
      mimeType: "text/html",
    };
  });
}
