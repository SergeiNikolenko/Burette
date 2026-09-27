import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import initRDKit, { type RDKitLoader } from "@rdkit/rdkit";
import { VIEWER_RESOURCE_URI } from "../lib/widget";
import { prepareStructureText } from "../lib/structure-service";

const packageRoot = resolve(import.meta.dir, "..");
const submission = JSON.parse(
  readFileSync(resolve(packageRoot, "chatgpt-app-submission.json"), "utf8"),
) as {
  schema_version: number;
  app_info: { subtitle: string };
  tools: Record<
    string,
    {
      annotations: {
        readOnlyHint: boolean;
        openWorldHint: boolean;
        destructiveHint: boolean;
      };
    }
  >;
  test_cases: Array<{ tools_triggered: string }>;
  negative_test_cases: Array<{ tools_triggered: null }>;
};

const publicToolNames = [
  "preview_molecular_file",
  "preview_pdb_structure",
  "render_molecular_scene",
  "open_ketcher",
  "control_ketcher",
] as const;

const publicToolAnnotations = {
  preview_molecular_file: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  preview_pdb_structure: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
  render_molecular_scene: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
  open_ketcher: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  control_ketcher: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
} as const;

describe("plugin submission bundle", () => {
  test("keeps listing metadata within portal limits", () => {
    expect(submission.schema_version).toBe(1);
    expect(submission.app_info.subtitle.length).toBeLessThanOrEqual(30);
  });

  test("covers every public tool with explicit safe annotations", () => {
    expect(Object.keys(submission.tools).sort()).toEqual([...publicToolNames].sort());
    for (const toolName of publicToolNames) {
      expect(submission.tools[toolName]?.annotations).toEqual(publicToolAnnotations[toolName]);
    }
  });

  test("provides exactly five independent positive and three negative review cases", () => {
    expect(submission.test_cases).toHaveLength(5);
    expect(submission.negative_test_cases).toHaveLength(3);
    for (const testCase of submission.test_cases) {
      expect(publicToolNames as readonly string[]).toContain(
        testCase.tools_triggered,
      );
    }
    expect(new Set(submission.test_cases.map((testCase) => testCase.tools_triggered)))
      .toEqual(new Set(publicToolNames));
    for (const testCase of submission.negative_test_cases) {
      expect(testCase.tools_triggered).toBeNull();
    }
  });

  test("ships a chemically valid three-record handoff matching the reviewer expectations", async () => {
    const fixture = JSON.parse(readFileSync(resolve(packageRoot, "submission/review-fixtures.json"), "utf8"));
    const sdf = readFileSync(resolve(packageRoot, fixture.file), "utf8");
    expect(createHash("sha256").update(sdf).digest("hex")).toBe(fixture.sha256);
    const summary = prepareStructureText(sdf, "salicylate-series.sdf", "attachment").summary;
    expect({ counts: summary.counts, elements: summary.components.elements,
      names: summary.components.molecules?.map((molecule) => molecule.title) }).toEqual({
      counts: { molecules: 3, atoms: 34, bonds: 34, elements: 2 },
      elements: { C: 24, O: 10 },
      names: ["Salicylic acid", "Aspirin", "Methyl salicylate"],
    });
    // The package exports a CommonJS loader but its declarations only name its type.
    const rdkit = await (initRDKit as unknown as RDKitLoader)();
    const records = sdf.split(/^\$\$\$\$\s*$/mu).filter((record) => record.trim());
    expect(records).toHaveLength(3);
    for (const [index, record] of records.entries()) {
      const molecule = rdkit.get_mol(record.trim());
      if (!molecule) throw new Error(`Review fixture molecule ${index + 1} is invalid.`);
      try {
        expect(molecule.get_smiles()).toBe(fixture.molecules[index].canonicalSmiles);
      } finally { molecule.delete(); }
    }
  });

  test("ships a narrowly scoped skill that names every public tool", () => {
    const skill = readFileSync(
      resolve(
        packageRoot,
        "submission/skills/preview-molecular-structures/SKILL.md",
      ),
      "utf8",
    );
    expect(skill).toContain("name: preview-molecular-structures");
    for (const toolName of publicToolNames) {
      expect(skill).toContain(`\`${toolName}\``);
    }
    expect(skill).toContain("Do not claim local macOS app control");
  });

  test("keeps submission documentation aligned with the current widget URI", () => {
    const readme = readFileSync(resolve(packageRoot, "README.md"), "utf8");
    expect(readme).toContain(VIEWER_RESOURCE_URI);
  });
});
