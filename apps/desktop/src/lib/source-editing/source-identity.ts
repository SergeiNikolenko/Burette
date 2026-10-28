export async function sha256Hex(bytes: Uint8Array | string) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Atom positions of a binding's frame, compared within the precision Mol* keeps (float32). */
export function positionsMatch(expected: ArrayLike<number>, actual: ArrayLike<number>, tolerance = 1e-3) {
  if (expected.length !== actual.length) return false;
  for (let index = 0; index < expected.length; index++) if (!(Math.abs(expected[index] - actual[index]) <= tolerance)) return false;
  return true;
}
