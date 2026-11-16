import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { crc32 as zlibCrc32, gunzipSync, gzipSync } from "node:zlib";
// The reference encoder, for frames that do not declare their size.
import { Zstd } from "../apps/desktop/node_modules/@hpcc-js/wasm-zstd/dist/index.js";
import { checkZstdFrames, decodeCompressedText, encodeCompressedText } from "../apps/desktop/src/lib/compressed-files/codecs";
import { compressedName, supportedCompressedName } from "../apps/desktop/src/lib/compressed-files/formats";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/compressed/${name}`, import.meta.url)));
const sample = (path: string) => readFileSync(new URL(`../samples/${path}`, import.meta.url), "utf8");
const decode = (name: string, bytes: Uint8Array, options?: Parameters<typeof decodeCompressedText>[2]) => decodeCompressedText(name, bytes, options);
const concat = (...parts: ArrayLike<number>[]) => Uint8Array.from(parts.flatMap((part) => Array.from(part)));
const flip = (bytes: Uint8Array, index: number) => { const copy = bytes.slice(); copy[index] ^= 0x10; return copy; };
const MiB = 1024 * 1024;

describe("compressed names", () => {
  test("keep the inner format and say which copies the browser can write", () => {
    expect([
      "1abc.pdb.gz", "reads.pdb.bgz", "caffeine.sdf.xz", "mini.cif.zst", "mini.cif.zstd", "complex.maegz", "plain.pdb",
    ].map((name) => compressedName(name) && [compressedName(name)!.codec, compressedName(name)!.innerName, compressedName(name)!.exportName])).toEqual([
      ["gzip", "1abc.pdb", "1abc.pdb.gz"], ["gzip", "reads.pdb", "reads.pdb.gz"], ["xz", "caffeine.sdf", "caffeine.sdf.xz"],
      ["zstd", "mini.cif", "mini.cif.zst"], ["zstd", "mini.cif", "mini.cif.zstd"], ["gzip", "complex.mae", "complex.maegz"], null,
    ]);
  });
  test("refuse archives, nesting and formats the browser does not open", () => {
    expect(() => supportedCompressedName("bundle.tar.gz")).toThrow("Compressed .tar files cannot be opened in the browser");
    expect(() => supportedCompressedName("traj.xtc.zst")).toThrow("Compressed .xtc files");
    expect(() => supportedCompressedName("1abc.pdb.gz.xz")).toThrow("compressed more than once");
    expect(() => supportedCompressedName("data.gz")).toThrow("does not name the format inside");
    expect(supportedCompressedName("molden.input.gz").innerName).toBe("molden.input");
  });
});

/**
 * The fixture member rebuilt with optional header fields (gzip -n writes none),
 * with a header checksum by zlib's rule: the low 16 bits of the header's CRC-32.
 */
function withHeaderFields(member: Uint8Array, fields: { extra?: number[]; name?: string; comment?: string; hcrc?: boolean }) {
  const flags = (fields.hcrc ? 2 : 0) | (fields.extra ? 4 : 0) | (fields.name !== undefined ? 8 : 0) | (fields.comment !== undefined ? 16 : 0);
  const header = [...member.subarray(0, 3), flags, ...member.subarray(4, 10)];
  if (fields.extra) header.push(fields.extra.length & 0xff, fields.extra.length >> 8, ...fields.extra);
  if (fields.name !== undefined) header.push(...Buffer.from(fields.name, "latin1"), 0);
  if (fields.comment !== undefined) header.push(...Buffer.from(fields.comment, "latin1"), 0);
  if (fields.hcrc) { const crc = zlibCrc32(Uint8Array.from(header)) & 0xffff; header.push(crc & 0xff, crc >> 8); }
  return concat(header, member.subarray(10));
}

describe("gzip member headers", () => {
  const member = fixture("mini.pdb.gz");
  const valid = withHeaderFields(member, { extra: [0x42, 0x43, 2, 0, 0x34, 0x12], name: "mini.pdb", comment: "test", hcrc: true });
  const hcrcAt = valid.length - (member.length - 10) - 2;
  // Each input is read by zlib and by the browser reader; both must agree on what it holds.
  const outcome = (read: () => string | Promise<string>) => Promise.resolve().then(read).then((text) => text, () => "refused");
  const cases: [string, Uint8Array][] = [
    ["header checksum only", withHeaderFields(member, { hcrc: true })],
    ["extra field, name, comment and header checksum", valid],
    ["header checksum flipped", flip(valid, hcrcAt)],
    ["name byte changed under the checksum", flip(valid, 10 + 8 + 2)],
    ["second member with a wrong header checksum", concat(member, flip(valid, hcrcAt + 1))],
    ["second member with a good header checksum", concat(withHeaderFields(member, { name: "a", hcrc: true }), valid)],
    ["name cut before its terminator", valid.subarray(0, 10 + 8 + 4)],
    ["extra field longer than the file", withHeaderFields(member, { extra: Array(4000).fill(1) }).subarray(0, 2000)],
  ];

  test("optional fields and header checksums are accepted and refused exactly as zlib does", async () => {
    const zlib = await Promise.all(cases.map(([, bytes]) => outcome(() => gunzipSync(bytes).toString("utf8"))));
    const browser = await Promise.all(cases.map(([, bytes]) => outcome(async () => (await decode("mini.pdb.gz", bytes)).text)));
    const text = sample("mini.pdb");
    expect(zlib).toEqual([text, text, "refused", "refused", "refused", text + text, "refused", "refused"]);
    expect(browser).toEqual(zlib);
  });

  test("a wrong header checksum is named, in the first member or a later one, and limits still apply", async () => {
    await expect(decode("mini.pdb.gz", flip(valid, hcrcAt))).rejects.toThrow("mini.pdb.gz is corrupt: a gzip header does not match its checksum");
    await expect(decode("mini.pdb.gz", concat(member, flip(valid, 12)))).rejects.toThrow("a gzip header does not match its checksum");
    await expect(decode("mini.pdb.gz", valid.subarray(0, 20))).rejects.toThrow("mini.pdb.gz is truncated");
    // The member CRC-32 and length are still checked behind a valid header checksum.
    await expect(decode("mini.pdb.gz", flip(valid, valid.length - 2))).rejects.toThrow("does not match its checksum");
    await expect(decode("mini.pdb.gz", valid, { maxBytes: 100 })).rejects.toThrow("expands beyond the");
    expect((await decode("mini.pdb.gz", valid, { prefixBytes: 6 })).text).toBe("HEADER");
  });
});

describe("reading real compressed files", () => {
  test("gzip, gzip members, XZ, XZ streams, Zstandard and Zstandard frames decode to the exact text", async () => {
    const results = await Promise.all([
      ["mini.pdb.gz", "mini.pdb"], ["mini-members.pdb.gz", "mini.pdb"], ["caffeine.sdf.xz", "structures/small-molecules/caffeine.sdf"],
      ["mini-streams.xyz.xz", "mini.xyz"], ["mini.cif.zst", "mini.cif"], ["mini-frames.pdb.zst", "mini.pdb"],
    ].map(async ([name, expected]) => (await decode(name, fixture(name))).text === sample(expected)));
    expect(results).toEqual([true, true, true, true, true, true]);
  });
  test("BGZF-style members, XZ stream padding and Zstandard skippable frames are part of the formats", async () => {
    const skippable = [0x50, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1, 2, 3];
    expect((await decode("reads.pdb.bgz", concat(fixture("mini-members.pdb.gz"), gzipSync(Buffer.alloc(0))))).text).toBe(sample("mini.pdb"));
    expect((await decode("mini.xyz.xz", concat(fixture("mini-streams.xyz.xz"), [0, 0, 0, 0]))).text).toBe(sample("mini.xyz"));
    expect((await decode("mini.pdb.zst", concat(skippable, fixture("mini-frames.pdb.zst"), skippable))).text).toBe(sample("mini.pdb"));
  });
  test("a byte order mark is not part of the text; the bytes after it are", async () => {
    expect((await decode("bom.xyz.gz", gzipSync(Buffer.from(`﻿${sample("mini.xyz")}`)))).text).toBe(sample("mini.xyz"));
  });
});

describe("refusing files that do not decode completely", () => {
  const cases: [string, Uint8Array][] = [
    ["mini.pdb.gz", fixture("mini.pdb.gz")], ["mini-members.pdb.gz", fixture("mini-members.pdb.gz")],
    ["caffeine.sdf.xz", fixture("caffeine.sdf.xz")], ["mini-streams.xyz.xz", fixture("mini-streams.xyz.xz")],
    ["mini.cif.zst", fixture("mini.cif.zst")], ["mini-frames.pdb.zst", fixture("mini-frames.pdb.zst")],
  ];
  test("every truncation, through the last trailer byte, is refused unless it ends a whole member", async () => {
    const accepted: string[] = [];
    for (const [name, bytes] of cases) {
      for (let end = 6; end < bytes.length; end++) {
        await decode(name, bytes.subarray(0, end)).then(({ text }) => accepted.push(`${name}:${text.length}`), () => {});
      }
    }
    // Cutting exactly after the first member, stream or frame leaves a complete, shorter file: its own text.
    expect(accepted).toEqual(["mini-members.pdb.gz:400", "mini-streams.xyz.xz:50", "mini-frames.pdb.zst:400"]);
  });
  test("data after the last member, stream or frame is refused", async () => {
    const results = await Promise.all(cases.map(([name, bytes]) => decode(name, concat(bytes, [1, 2, 3, 4, 5, 6, 7, 8])).then(() => "accepted", (error) => error.message)));
    expect(results.filter((message) => message === "accepted")).toEqual([]);
    expect(results[0]).toBe("mini.pdb.gz has data after its last gzip member");
    expect(results[4]).toBe("mini.cif.zst has data after its last Zstandard frame");
  });
  test("corruption is caught by each format's own checks", async () => {
    const gzip = fixture("mini.pdb.gz");
    await expect(decode("mini.pdb.gz", flip(gzip, gzip.length - 6))).rejects.toThrow("does not match its checksum");
    await expect(decode("mini.pdb.gz", flip(gzip, gzip.length - 2))).rejects.toThrow("does not match its checksum");
    const members = fixture("mini-members.pdb.gz");
    // The first member's CRC-32 sits just before the second member starts.
    const second = members.indexOf(0x1f, 20);
    await expect(decode("mini-members.pdb.gz", flip(members, second - 6))).rejects.toThrow("does not match its checksum");
    const xz = fixture("caffeine.sdf.xz");
    await expect(decode("caffeine.sdf.xz", flip(xz, 200))).rejects.toThrow("caffeine.sdf.xz is corrupt");
    const zstd = fixture("mini.cif.zst");
    await expect(decode("mini.cif.zst", flip(zstd, zstd.length - 1))).rejects.toThrow("Zstandard checksum does not match");
  });
  test("a name that does not match the bytes is refused", async () => {
    await expect(decode("caffeine.sdf.gz", fixture("caffeine.sdf.xz"))).rejects.toThrow("caffeine.sdf.gz is named as gzip but contains XZ data");
    await expect(decode("mini.pdb.zst", fixture("mini.pdb.gz"))).rejects.toThrow("is named as Zstandard but contains gzip data");
    await expect(decode("mini.pdb.xz", new TextEncoder().encode(sample("mini.pdb")))).rejects.toThrow("is named as XZ but is not XZ data");
  });
  test("XZ checks and dictionaries the decoder cannot honour are refused by name", async () => {
    await expect(decode("sha256-check.xyz.xz", fixture("sha256-check.xyz.xz"))).rejects.toThrow("integrity check or filter the browser cannot read");
    await expect(decode("dict-128mib.xyz.xz", fixture("dict-128mib.xyz.xz"))).rejects.toThrow("dictionary larger than the 64 MiB browser limit");
  });
  test("decoded payloads must be one UTF-8 text file", async () => {
    await expect(decode("nested.pdb.gz", gzipSync(gzipSync(Buffer.from(sample("mini.pdb")))))).rejects.toThrow("contains compressed data inside; nested archives are not opened");
    await expect(decode("zip.pdb.gz", gzipSync(Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(20, 65)])))).rejects.toThrow("a ZIP archive");
    await expect(decode("binary.pdb.gz", gzipSync(Buffer.from("ATOM\0\0\0")))).rejects.toThrow("contains binary data");
    await expect(decode("latin1.pdb.gz", gzipSync(Buffer.from([0x41, 0xe9, 0x0a])))).rejects.toThrow("does not contain UTF-8 text");
    await expect(decode("empty.pdb.gz", gzipSync(Buffer.alloc(0)))).rejects.toThrow("is empty once decompressed");
  });
});

describe("limits while decoding", () => {
  test("output exactly at the limit is kept; one byte more is refused", async () => {
    const text = Buffer.from("ATOM 分子 🧪\n".repeat(200));
    const zstd = await Zstd.load();
    for (const [name, bytes] of [["x.pdb.gz", gzipSync(text)], ["x.pdb.zst", zstd.compress(text, 3)]] as const) {
      expect((await decode(name, bytes, { maxBytes: text.length })).byteCount).toBe(text.length);
      await expect(decode(name, bytes, { maxBytes: text.length - 1 })).rejects.toThrow(`expands beyond the`);
    }
  });
  test("65 MiB bombs stop at 64 MiB in every format, including a later gzip member", async () => {
    const spaces = Buffer.alloc(65 * MiB, 32);
    const zstd = await Zstd.load();
    const bombs: [string, Uint8Array][] = [
      ["bomb.xyz.gz", gzipSync(spaces, { level: 9 })],
      ["members.xyz.gz", concat(gzipSync(Buffer.from("1\n\nH 0 0 0\n")), gzipSync(spaces, { level: 9 }))],
      ["spaces-65mib.xyz.xz", fixture("spaces-65mib.xyz.xz")],
      // Streamed frames carry no size, so only decoding finds the size.
      ["bomb.xyz.zst", (() => { zstd.resetCompression(19); const head = zstd.compressChunk(spaces); return concat(head, zstd.compressEnd()); })()],
    ];
    for (const [name, bytes] of bombs) await expect(decode(name, bytes)).rejects.toThrow(`${name} expands beyond the 64 MiB limit for decompressed files`);
  });
  test("Zstandard headers that declare too much are refused before decoding", () => {
    // Single-segment frame declaring 128 MiB of content, with one empty raw block.
    const declared = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0, 0, 0, 8, 1, 0, 0]);
    expect(() => checkZstdFrames("huge.pdb.zst", declared, 64 * MiB)).toThrow("Zstandard window larger than the 64 MiB browser limit");
    // A 128 MiB window (exponent 17) with no content size.
    expect(() => checkZstdFrames("window.pdb.zst", Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 17 << 3, 1, 0, 0]), 64 * MiB)).toThrow("Zstandard window larger than the 64 MiB browser limit");
    // Two frames whose declared sizes add up past the limit.
    const frame = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0, 0, 0x80, 0x02, 1, 0, 0]);
    expect(() => checkZstdFrames("two.pdb.zst", concat(frame, frame), 64 * MiB)).toThrow("expands beyond the 64 MiB limit");
    expect(() => checkZstdFrames("dict.pdb.zst", Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x21, 7, 5, 1, 0, 0]), 64 * MiB)).toThrow("needs a Zstandard dictionary");
    expect(() => checkZstdFrames("start.pdb.zst", fixture("mini.cif.zst").subarray(0, 40), 64 * MiB, true)).not.toThrow();
  });
  test("a prefix read returns the start without decoding the whole file", async () => {
    const prefix = await decode("spaces-65mib.xyz.xz", fixture("spaces-65mib.xyz.xz"), { prefixBytes: 1024 });
    expect([prefix.byteCount, prefix.text.trim()]).toEqual([1024, ""]);
    // The start of a file is enough once it holds a whole block; inside the first block it is not.
    expect((await decode("mini.pdb.zst", fixture("mini-frames.pdb.zst").subarray(0, 200), { prefixBytes: 64 })).text).toBe(sample("mini.pdb").slice(0, 64));
    await expect(decode("mini.pdb.zst", fixture("mini-frames.pdb.zst").subarray(0, 60), { prefixBytes: 64 })).rejects.toThrow("is truncated");
  });
});

describe("writing compressed copies", () => {
  test("gzip, XZ and Zstandard copies read back as exactly the text", async () => {
    const text = `${sample("mini.pdb")}REMARK edited é\r\n`;
    for (const codec of ["gzip", "xz", "zstd"] as const) {
      const bytes = await encodeCompressedText(codec, text);
      expect((await decode(codec === "gzip" ? "copy.pdb.gz" : codec === "xz" ? "copy.pdb.xz" : "copy.pdb.zst", bytes)).text).toBe(text);
    }
    expect(Array.from((await encodeCompressedText("gzip", "x")).subarray(4, 8))).toEqual([0, 0, 0, 0]);
    const repeated = `${sample("mini.pdb")}REMARK Unicode é\r\n`.repeat(100);
    const xz = await encodeCompressedText("xz", repeated);
    expect(xz.length).toBeLessThan(new TextEncoder().encode(repeated).length / 10);
    expect((await decode("copy.pdb.xz", xz)).text).toBe(repeated);
    for (const broken of [xz.subarray(0, xz.length - 1), Uint8Array.from(xz, (byte, index) => index === 20 ? byte ^ 1 : byte)]) {
      await expect(decode("copy.pdb.xz", broken)).rejects.toThrow(/corrupt|truncated/u);
    }
    await expect(encodeCompressedText("xz", "x".repeat(64 * MiB + 1))).rejects.toThrow("larger than 64 MiB");
  });
});
