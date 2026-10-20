import { describe, expect, test } from "bun:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { inflateStructureBytes } from "../apps/desktop/src/lib/structure-inflate";

describe("bounded structure decompression", () => {
  test("preserves complete UTF-8 at the exact boundary", async () => {
    const text = Buffer.from("Molecule 分子 🧪\n".repeat(100));
    expect(Buffer.from(await inflateStructureBytes(gzipSync(text), text.length))).toEqual(text);
    await expect(inflateStructureBytes(gzipSync(text), text.length - 1)).rejects.toThrow("decompressed preview limit");
  });
  test("rejects corruption and an oversized later gzip member", async () => {
    const first = gzipSync(Buffer.from("first\n"));
    const second = gzipSync(Buffer.alloc(100_000, 32));
    await expect(inflateStructureBytes(Buffer.concat([first, second]), 1024)).rejects.toThrow();
    const corrupt = Buffer.from(first);
    corrupt[corrupt.length - 8] ^= 1;
    await expect(inflateStructureBytes(corrupt, 1024)).rejects.toThrow();
    await expect(inflateStructureBytes(first.subarray(0, first.length - 1), 1024)).rejects.toThrow();
  });
  test("browser document entry points use bounded decompression", async () => {
    const source = readFileSync(new URL("../apps/desktop/src/lib/browser-dev-documents.ts", import.meta.url), "utf8");
    const start = source.indexOf("async function inflateCompressedStructure(");
    const end = source.indexOf("\nfunction browserDevSourceByteCount", start);
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
    const api = new Function("inflateStructureBytes", "COMPRESSED_STRUCTURE_NAME", "fileTitle", "MAX_STRUCTURE_FILE_SIZE", "decodeUtf8", `${code}\nreturn {inflateCompressedStructure, decodeStructureText};`)(
      inflateStructureBytes, /\.(pdb|cif)\.gz$/i, basename, 1024, (bytes: Uint8Array) => new TextDecoder().decode(bytes),
    );
    const bytes = gzipSync(Buffer.from("ordinary coordinates"));
    expect(await api.decodeStructureText(bytes, "maegz")).toBe("ordinary coordinates");
    expect(Buffer.from(await api.inflateCompressedStructure("sample.pdb.gz", bytes))).toEqual(Buffer.from("ordinary coordinates"));
    await expect(api.inflateCompressedStructure("sample.pdb.gz", gzipSync(Buffer.alloc(1025)))).rejects.toThrow("decompressed preview limit");
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1, 32));
    await expect(api.decodeStructureText(bomb, "maegz")).rejects.toThrow("decompressed preview limit");
  });
  test("server and CLI entry points reject inflation before conversion", () => {
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1, 32));
    for (const path of ["apps/desktop/vite.config.ts", "scripts/agent-shell-server.mjs"]) {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      const start = source.indexOf("function readableTextBytes(");
      const end = source.indexOf("\nfunction ", start + 1);
      const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
      const read = new Function("gunzipSync", `${code}\nreturn readableTextBytes;`)(gunzipSync);
      expect(read(gzipSync(Buffer.from("ordinary")), "maegz").toString()).toBe("ordinary");
      expect(() => read(bomb, "maegz")).toThrow();
    }
    const source = readFileSync(new URL("../scripts/agent-preview.mjs", import.meta.url), "utf8");
    const start = source.indexOf("function preparePreviewPayload(");
    const end = source.indexOf("\nfunction previewExtension(", start);
    let conversions = 0;
    const prepare = new Function("gunzipSync", "basename", "isPreferredTextArtifact", "previewExtension", "coordinateArtifactExtensions", "textArtifactExtensions", "isMaestroPreviewFile", "maestroPdbDataFromText", "inferFormat", "isBinaryFormat", `${source.slice(start, end)}\nreturn preparePreviewPayload;`)(
      gunzipSync, basename, () => false, (path: string) => extname(path).slice(1), new Set(), new Set(), () => true,
      () => { conversions++; return { text: "PDB" }; }, () => "mae", () => false,
    );
    expect(prepare("small.mae.gz", gzipSync(Buffer.from("ordinary"))).format).toBe("pdb");
    expect(() => prepare("bomb.mae.gz", bomb)).toThrow();
    expect(conversions).toBe(1);
  });
});
