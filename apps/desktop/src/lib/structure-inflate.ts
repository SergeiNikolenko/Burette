/** Bound decompressed bytes before retaining a complete molecular payload. */
export async function inflateStructureBytes(bytes: Uint8Array, maxBytes: number) {
  const stream = new Blob([new Uint8Array(bytes).buffer]).stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`Structure exceeds the ${maxBytes / (1024 * 1024)} MiB decompressed preview limit`);
      if (value.byteLength) chunks.push(value);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
