import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  assertPublicHttpsUrl,
  MAX_PUBLIC_STRUCTURE_BYTES,
  MAX_PUBLIC_STRUCTURE_LINES,
  prepareStructureText,
  StructureServiceError,
} from "../lib/structure-service";
import { PUBLIC_OUTPUT_LIMITS } from "../lib/contracts";

const miniPdbPath = new URL("../../../samples/mini.pdb", import.meta.url);

describe("public structure preparation", () => {
  test("returns a bounded PDB summary and viewer payload without local paths", async () => {
    const text = await readFile(miniPdbPath, "utf8");
    const prepared = prepareStructureText(text, "mini.pdb", "attachment");

    expect(prepared.summary.source).toBe("attachment");
    expect(prepared.summary.fileName).toBe("mini.pdb");
    expect(prepared.summary.counts.atoms).toBe(9);
    expect(prepared.summary.components.chains?.length).toBe(1);
    expect("path" in prepared.summary).toBe(false);
    expect(prepared.viewer).toEqual({
      data: text,
      format: "pdb",
      label: "mini.pdb",
    });
  });

  test("prepares an SDF molecule for the same viewer", () => {
    const text = [
      "Methane",
      "  Burrete",
      "",
      "  1  0  0  0  0  0            999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "M  END",
      "$$$$",
      "",
    ].join("\n");
    const prepared = prepareStructureText(text, "methane.sdf", "attachment");

    expect(prepared.summary.format).toBe("SDF");
    expect(prepared.summary.counts.molecules).toBe(1);
    expect(prepared.viewer.format).toBe("sdf");
  });

  test("rejects unsupported formats", () => {
    expect(() => prepareStructureText("hello", "notes.txt", "attachment")).toThrow(
      StructureServiceError,
    );
  });

  test("rejects oversized inline structures before parsing", () => {
    expect(() =>
      prepareStructureText(
        "x".repeat(MAX_PUBLIC_STRUCTURE_BYTES + 1),
        "large.xyz",
        "attachment",
      ),
    ).toThrow(/public preview limit/u);
  });

  test("bounds attacker-controlled SDF titles before model exposure", () => {
    const text = [
      "x".repeat(1024 * 1024),
      "  Burrete",
      "",
      "  1  0  0  0  0  0            999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "M  END",
      "$$$$",
      "",
    ].join("\n");
    const prepared = prepareStructureText(text, "bounded.sdf", "attachment");
    const title = prepared.summary.components.molecules?.[0]?.title;

    expect(String(title).length).toBe(PUBLIC_OUTPUT_LIMITS.scalarChars);
    expect(JSON.stringify(prepared.summary).length).toBeLessThan(10_000);
  });

  test("rejects pathological line-count amplification before parsing", () => {
    expect(() =>
      prepareStructureText(
        "\n".repeat(MAX_PUBLIC_STRUCTURE_LINES),
        "many-lines.xyz",
        "attachment",
      ),
    ).toThrow(/line public preview limit/u);
  });
});

describe("attachment URL boundary", () => {
  test("rejects non-HTTPS URLs", async () => {
    await expect(assertPublicHttpsUrl("http://example.com/file.pdb")).rejects.toThrow(
      /public HTTPS URL/u,
    );
  });

  test("rejects private IPv4 URLs", async () => {
    await expect(assertPublicHttpsUrl("https://127.0.0.1/file.pdb")).rejects.toThrow(
      /Private or local/u,
    );
  });

  test("rejects local hostnames", async () => {
    await expect(assertPublicHttpsUrl("https://viewer.local/file.pdb")).rejects.toThrow(
      /Private or local/u,
    );
  });

  test("rejects private and translated IPv6 literals", async () => {
    await expect(assertPublicHttpsUrl("https://[::1]/file.pdb")).rejects.toThrow(
      /Private or local/u,
    );
    await expect(
      assertPublicHttpsUrl("https://[64:ff9b::7f00:1]/file.pdb"),
    ).rejects.toThrow(/Private or local/u);
  });
});
