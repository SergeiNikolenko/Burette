import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Monochrome atom glyph for host navigation (sidebar, thread tabs, file
// viewers): a 20x20 viewport, 1.33px strokes and currentColor, as the OpenAI
// MCP Extensions icon guidelines ask. It mirrors the composer icon's atom.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.33">'
  + '<ellipse cx="10" cy="10" rx="8" ry="3.25"/><ellipse cx="10" cy="10" rx="8" ry="3.25" transform="rotate(60 10 10)"/>'
  + '<ellipse cx="10" cy="10" rx="8" ry="3.25" transform="rotate(-60 10 10)"/><circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none"/></svg>';

export const buretteIcons = [{ src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, mimeType: 'image/svg+xml', sizes: ['any'] }];

// McpServer builds tools/list without the protocol's `icons` field, so the
// listed entrypoint tools get the glyph after the SDK assembles the list.
export function addToolIcons(server, toolNames) {
  const names = new Set(toolNames);
  const list = server.server._requestHandlers.get('tools/list');
  if (!list) throw new Error('Register tools before adding their icons.');
  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await list(request, extra);
    return { ...result, tools: result.tools.map(tool => names.has(tool.name) ? { ...tool, icons: buretteIcons } : tool) };
  });
}
