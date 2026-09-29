import { z } from 'zod';

// Composer at-mentions (OpenAI MCP Extensions): the user types @Burette and a
// query, and picks PDB entries as resource links. The model opens a picked
// entry with the pdbId argument of the workspace openers.
const MAX_ITEMS = 8;
const suggestions = ['1HTB', '4HHB', '1STP', '6LU7'];
const pdbId = /^[0-9][A-Za-z0-9]{3}$/u;

async function rcsb(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`RCSB returned HTTP ${response.status}.`);
  return response.json();
}

async function searchIds(query) {
  if (!query) return suggestions;
  if (pdbId.test(query)) return [query.toUpperCase()];
  const found = await rcsb('https://search.rcsb.org/rcsbsearch/v2/query', {
    query: { type: 'terminal', service: 'full_text', parameters: { value: query } },
    return_type: 'entry', request_options: { paginate: { start: 0, rows: MAX_ITEMS } },
  });
  return (found?.result_set || []).map(item => item.identifier).filter(id => pdbId.test(id));
}

// Null when RCSB is unreachable: the IDs are then offered untitled.
async function titles(ids) {
  const found = await rcsb('https://data.rcsb.org/graphql', { query: `{entries(entry_ids:${JSON.stringify(ids)}){rcsb_id struct{title}}}` }).catch(() => null);
  return found?.data ? new Map((found.data.entries || []).filter(Boolean).map(entry => [entry.rcsb_id, entry.struct?.title || ''])) : null;
}

export async function searchMentions(query) {
  const ids = (await searchIds(query.trim())).slice(0, MAX_ITEMS);
  if (!ids.length) return [];
  const named = await titles(ids);
  // An exact ID RCSB does not know is not offered.
  return ids.filter(id => !named || named.has(id)).map(id => {
    const title = named?.get(id)?.replace(/\s+/gu, ' ').trim().slice(0, 120);
    return { type: 'resource_link', uri: `https://www.rcsb.org/structure/${id}`, name: id, title: title ? `${id} · ${title}` : id,
      description: `PDB entry ${id}. Open it in Burette with pdbId "${id}".`, mimeType: 'text/html' };
  });
}

export function registerMentions(server) {
  server.registerTool('burette.mentions', {
    title: 'Burette structures',
    description: 'Composer at-mention search for PDB entries. Called by the host, not the model.',
    inputSchema: { query: z.string().max(200) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { 'openai/extensions': { 'mentions/search': {} }, ui: { visibility: ['app'] } },
  }, async ({ query }) => {
    try { return { content: [], structuredContent: { items: await searchMentions(query) } }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: `PDB search failed: ${error.message}` }] }; }
  });
}
