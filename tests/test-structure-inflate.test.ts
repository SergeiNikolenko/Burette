import { describe, expect, test } from "bun:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

// Browser reads of compressed files use the shared bounded decoder; see test-compressed-routes.test.tsx.
describe("bounded structure decompression", () => {
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
