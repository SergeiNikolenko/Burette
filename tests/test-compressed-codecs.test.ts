import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { decodeCompressedText, encodeCompressedText } from "../apps/desktop/src/lib/compressed-files/codecs";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/compressed/${name}`, import.meta.url)));
const sample = (name: string) => readFileSync(new URL(`../samples/${name}`, import.meta.url));
const cases = [
  ["mini.pdb.gz", "mini.pdb"], ["mini-members.pdb.gz", "mini.pdb"],
  ["caffeine.sdf.xz", "structures/small-molecules/caffeine.sdf"], ["mini-streams.xyz.xz", "mini.xyz"],
  ["mini.cif.zst", "mini.cif"], ["mini-frames.pdb.zst", "mini.pdb"],
];

test("reference files decode byte exactly at their limits, including every member and frame", async () => {
  for (const [name, path] of cases) {
    const input = fixture(name), original = input.slice(), expected = sample(path);
    const decoded = await decodeCompressedText(name, input, { maxBytes: expected.byteLength });
    expect([Buffer.from(decoded.text), decoded.byteCount]).toEqual([expected, expected.byteLength]);
    expect(input).toEqual(original);
    await expect(decodeCompressedText(name, input, { maxBytes: expected.byteLength - 1 })).rejects.toThrow("expands beyond");
    await expect(decodeCompressedText(name, input.subarray(0, input.length - 1))).rejects.toThrow(/truncated|corrupt/u);
  }
});

test("all three encoders preserve UTF-8, CRLF and byte budgets; BOM stays a decoded-byte cost", async () => {
  const text = "Molecule 分子 🧪\r\né\r\n", count = new TextEncoder().encode(text).length;
  for (const [codec, suffix] of [["gzip", "gz"], ["xz", "xz"], ["zstd", "zst"]] as const) {
    const bytes = await encodeCompressedText(codec, text), name = `unicode.sdf.${suffix}`;
    expect(await decodeCompressedText(name, bytes, { maxBytes: count })).toEqual({ text, codec, innerName: "unicode.sdf", byteCount: count });
    await expect(decodeCompressedText(name, bytes, { maxBytes: count - 1 })).rejects.toThrow("expands beyond");
  }
  const bom = gzipSync(Buffer.from(`\uFEFF${text}`));
  expect((await decodeCompressedText("bom.sdf.gz", bom, { maxBytes: count + 3 })).byteCount).toBe(count + 3);
  await expect(decodeCompressedText("bom.sdf.gz", bom, { maxBytes: count })).rejects.toThrow("expands beyond");
});

test("full reads refuse corrupt, binary, nested and mislabeled inputs before returning any text", async () => {
  for (const name of ["mini.pdb.gz", "caffeine.sdf.xz", "mini.cif.zst"]) {
    const bytes = fixture(name); bytes[bytes.length - (name.endsWith(".gz") ? 6 : name.endsWith(".xz") ? 20 : 1)] ^= 0x10;
    await expect(decodeCompressedText(name, bytes)).rejects.toThrow(/corrupt|checksum/u);
  }
  await expect(decodeCompressedText("wrong.sdf.gz", fixture("caffeine.sdf.xz"))).rejects.toThrow("contains XZ");
  for (const [text, reason] of [[Buffer.from("A\0B"), "binary"], [Buffer.from([0x41, 0xff]), "UTF-8"], [gzipSync(Buffer.from("nested")), "nested archives"]] as const) {
    await expect(decodeCompressedText("invalid.sdf.gz", gzipSync(text))).rejects.toThrow(reason);
  }
});
