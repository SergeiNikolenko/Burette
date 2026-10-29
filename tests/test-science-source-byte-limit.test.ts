import { expect, test } from "bun:test";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { ScienceSessionError, SCIENCE_SESSION_LIMITS } from "../apps/desktop/src/lib/science-session/contracts";

const encoder = new TextEncoder(), limit = SCIENCE_SESSION_LIMITS.sourceBytes;
function failureCode(text: string) {
  try { readXyzFrames(text); return null; }
  catch (error) { return error instanceof ScienceSessionError ? error.code : "unexpected"; }
}

test("XYZ source size counts UTF-8 bytes even when a multibyte comment fits the code-unit limit", () => {
  const text = "1\n" + "漢".repeat(Math.floor(limit / 3) + 1) + "\nH 0 0 0\n";
  expect(text.length < limit && encoder.encode(text).byteLength > limit).toBe(true);
  expect(failureCode(text)).toBe("source");
});

test("exact 16 MiB XYZ sources include header, coordinates and optional BOM in their byte budget", () => {
  for (const bom of ["", "\uFEFF"]) {
    const header = bom + "1\n", tail = "\nH 0 0 0\n", budget = limit - encoder.encode(header + tail).byteLength;
    const text = header + "漢".repeat(Math.floor(budget / 3)) + "a".repeat(budget % 3) + tail;
    expect(encoder.encode(text).byteLength).toBe(limit);
    const frames = readXyzFrames(text);
    expect(frames).toEqual([{ elements: ["H"], positions: Float64Array.of(0, 0, 0) }]);
    expect(failureCode(text + " ")).toBe("source");
    if (!bom) expect(failureCode("\uFEFF" + text)).toBe("source");
  }
});
