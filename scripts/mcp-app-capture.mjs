// Raster-only, bounded image transport. Never put base64 into model-visible JSON
// or accept an arbitrary file/URL as a screenshot from the mounted app.
export function captureToolResult(result) {
  const body = result?.result?.result;
  if (result?.action?.type !== 'capture_scene' || !body?.images) return null;
  if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > 2) throw new Error('Invalid capture image count.');
  const images = body.images.map((image, index) => {
    if (image.role !== (index === 0 ? 'scene' : 'ligand_2d')) throw new Error('Invalid capture image role.');
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(image.dataUri || '');
    if (!match || match[1].length > 1398104) throw new Error('Invalid or oversized capture PNG.');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length > 1024 * 1024) throw new Error('Capture PNG exceeds 1 MiB.');
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid capture PNG header.');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 1024 || height > 1024) throw new Error('Capture dimensions exceed 1024 pixels.');
    return { role: image.role, width, height, content: { type: 'image', mimeType: 'image/png', data: match[1] } };
  });
  const { images: ignored, ...metadata } = body;
  if (Buffer.byteLength(JSON.stringify(metadata)) > 64 * 1024) throw new Error('Capture metadata exceeds 64 KiB.');
  const structuredContent = { sessionId: result.sessionId, actionId: result.actionId, status: result.status, documentId: result.documentId, ...metadata, images: images.map(({ role, width, height }) => ({ role, width, height })) };
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }, ...images.map(image => image.content)], structuredContent };
}
