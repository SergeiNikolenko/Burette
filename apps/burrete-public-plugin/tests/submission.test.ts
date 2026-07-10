import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
] as const;

describe("plugin submission bundle", () => {
  test("keeps listing metadata within portal limits", () => {
    expect(submission.schema_version).toBe(1);
    expect(submission.app_info.subtitle.length).toBeLessThanOrEqual(30);
  });

  test("covers every public tool with explicit safe annotations", () => {
    expect(Object.keys(submission.tools).sort()).toEqual([...publicToolNames].sort());
    for (const tool of Object.values(submission.tools)) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      });
    }
  });

  test("provides exactly five positive and three negative review cases", () => {
    expect(submission.test_cases).toHaveLength(5);
    expect(submission.negative_test_cases).toHaveLength(3);
    for (const testCase of submission.test_cases) {
      expect(publicToolNames as readonly string[]).toContain(
        testCase.tools_triggered,
      );
    }
    for (const testCase of submission.negative_test_cases) {
      expect(testCase.tools_triggered).toBeNull();
    }
  });

  test("ships a narrowly scoped skill that names both public tools", () => {
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
});
