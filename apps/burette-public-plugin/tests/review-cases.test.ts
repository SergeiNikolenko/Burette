import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { KETCHER_AGENT_API_VERSION } from "@burette/ketcher-agent-contract";
import { createReviewClient, postRouteMessage } from "./review-route-client";

type SubmissionCase = {
  description: string;
  file_attachment_urls: string[] | null;
  tools_triggered: string;
};

type Submission = {
  tools: Record<string, { annotations: Record<string, boolean> }>;
  test_cases: SubmissionCase[];
};

const submission = JSON.parse(readFileSync(
  new URL("../chatgpt-app-submission.json", import.meta.url),
  "utf8",
)) as Submission;

const publicToolNames = [
  "preview_molecular_file",
  "preview_pdb_structure",
  "render_molecular_scene",
  "open_ketcher",
  "control_ketcher",
] as const;

const expectedIdempotence = {
  preview_molecular_file: true,
  preview_pdb_structure: true,
  render_molecular_scene: true,
  open_ketcher: false,
  control_ketcher: false,
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeObject();
  return value as Record<string, unknown>;
}

function structured(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  return asRecord(result.structuredContent);
}

function action(
  surfaceId: string,
  actionId: string,
  command: string,
  expectedRevision: number,
  fields: Record<string, unknown> = {},
) {
  return {
    action: {
      apiVersion: KETCHER_AGENT_API_VERSION,
      type: "control_ketcher",
      command,
      surfaceId,
      actionId,
      expectedRevision,
      ...fields,
    },
  };
}

let nextRequestId = 100;

async function rawRouteRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = nextRequestId;
  nextRequestId += 1;
  const messages = await postRouteMessage({ jsonrpc: "2.0", id, method, params });
  expect(messages).toHaveLength(1);
  const message = asRecord(messages[0]);
  expect(message.id).toBe(id);
  expect(message.error).toBeUndefined();
  return asRecord(message.result);
}

async function rawToolCall(
  name: string,
  arguments_: Record<string, unknown>,
): Promise<CallToolResult> {
  return await rawRouteRequest("tools/call", {
    name,
    arguments: arguments_,
  }) as CallToolResult;
}

async function callInFreshInstance(
  name: string,
  arguments_: Record<string, unknown>,
): Promise<CallToolResult> {
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("./review-case-instance.ts", import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      BURETTE_REVIEW_TOOL_REQUEST: JSON.stringify({ name, arguments: arguments_ }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const errorText = Buffer.concat(stderr).toString("utf8");
  expect(exitCode, errorText).toBe(0);
  return JSON.parse(Buffer.concat(stdout).toString("utf8")) as CallToolResult;
}

describe("OpenAI submission review cases", () => {
  test("publishes reviewable tool descriptors", async () => {
    const client = await createReviewClient();
    try {
      const listed = await client.listTools();
      const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
      expect([...tools.keys()].sort()).toEqual([...publicToolNames].sort());

      const rawListed = await rawRouteRequest("tools/list", {});
      const rawTools = new Map(
        (rawListed.tools as unknown[]).map((tool) => {
          const descriptor = asRecord(tool);
          return [String(descriptor.name), descriptor];
        }),
      );

      for (const name of publicToolNames) {
        const tool = tools.get(name) as Tool | undefined;
        expect(tool?.annotations).toEqual({
          ...submission.tools[name]?.annotations,
          idempotentHint: expectedIdempotence[name],
        });
        expect(tool?.outputSchema).toBeDefined();
        expect(tool?._meta?.securitySchemes).toEqual([{ type: "noauth" }]);
        expect(rawTools.get(name)?.securitySchemes).toEqual([{ type: "noauth" }]);
      }
    } finally {
      await client.close();
    }
  });

  test("executes all five submitted cases with exact schema-valid results", async () => {
    const client = await createReviewClient();
    try {
      await client.listTools();
      expect(submission.test_cases).toHaveLength(5);
      for (const reviewCase of submission.test_cases) {
        let result: CallToolResult;
        if (reviewCase.tools_triggered === "preview_molecular_file") {
          const downloadUrl = reviewCase.file_attachment_urls?.[0];
          expect(downloadUrl).toBeString();
          const fileName = new URL(downloadUrl!).pathname.split("/").at(-1)!;
          result = await client.callTool({
            name: reviewCase.tools_triggered,
            arguments: {
              structureFile: {
                download_url: downloadUrl,
                file_id: `review-${fileName}`,
                file_name: fileName,
              },
            },
          }) as CallToolResult;
        } else if (reviewCase.tools_triggered === "preview_pdb_structure") {
          result = await client.callTool({
            name: reviewCase.tools_triggered,
            arguments: { pdbId: "1CRN" },
          }) as CallToolResult;
        } else {
          result = await client.callTool({
            name: reviewCase.tools_triggered,
            arguments: { structure: { format: "smiles", content: "CCO" } },
          }) as CallToolResult;
        }

        const output = structured(result);
        if (reviewCase.description.includes("attached PDB")) {
          expect(output.counts).toMatchObject({ chains: 1, residues: 2, atoms: 9 });
        } else if (reviewCase.description.includes("mmCIF")) {
          expect(output.counts).toMatchObject({ chains: 1, residues: 1, atoms: 4 });
          expect(asRecord(output.components).elements).toEqual({ N: 1, C: 2, O: 1 });
        } else if (reviewCase.description.includes("SDF")) {
          expect(output.counts).toMatchObject({ molecules: 2, atoms: 9, bonds: 8 });
          expect(asRecord(output.components).elements).toEqual({ O: 1, H: 2, C: 6 });
        } else if (reviewCase.tools_triggered === "preview_pdb_structure") {
          expect(output.counts).toMatchObject({ chains: 1, residues: 46, atoms: 327 });
        } else {
          const ketcher = asRecord(output.ketcher);
          expect(ketcher.structureRevision).toBe(1);
          expect(asRecord(ketcher.structure)).toMatchObject({
            kind: "molecule",
            atomCount: 3,
            smiles: "CCO",
          });
        }
      }
    } finally {
      await client.close();
    }
  }, 30_000);

  test("completes the open, set, get, and clear Ketcher review flow", async () => {
    const opened = structured(await rawToolCall("open_ketcher", {
      structure: { format: "smiles", content: "CCO" },
    }));
    const surfaceId = String(opened.surfaceId);

    const setResult = await rawToolCall(
      "control_ketcher",
      action(surfaceId, "review-set", "set_structure", 1, {
        format: "smiles",
        content: "CCN",
      }),
    );
    const setOutput = asRecord(setResult.structuredContent);
    const revision = setResult.isError ? 1 : Number(asRecord(setOutput.snapshot).structureRevision);

    const getResult = await rawToolCall(
      "control_ketcher",
      action(surfaceId, "review-get", "get_structure", revision, {
        formats: ["smiles"],
        delivery: "inline",
      }),
    );
    const clearResult = await rawToolCall(
      "control_ketcher",
      action(surfaceId, "review-clear", "clear_structure", revision),
    );

    const set = structured(setResult);
    expect(set.ok).toBe(true);
    expect(asRecord(set.snapshot).structureRevision).toBe(2);

    const get = structured(getResult);
    expect(asRecord(asRecord(get.result).result).formats).toEqual({ smiles: "CCN" });

    const clear = structured(clearResult);
    expect(clear.ok).toBe(true);
    expect(asRecord(clear.snapshot).structureRevision).toBe(3);
    expect(asRecord(asRecord(clear.snapshot).structure)).toMatchObject({
      kind: "empty",
      atomCount: 0,
    });
  });

  test("keeps every Ketcher action conformant with its advertised output schema", async () => {
    const client = await createReviewClient();
    try {
      await client.listTools();
      const opened = structured(await client.callTool({
        name: "open_ketcher",
        arguments: { structure: { format: "smiles", content: "CCO" } },
      }) as CallToolResult);
      await client.callTool({
        name: "control_ketcher",
        arguments: action(String(opened.surfaceId), "schema-set", "set_structure", 1, {
          format: "smiles",
          content: "CCN",
        }),
      });
    } finally {
      await client.close();
    }
  });

  test("keeps one Ketcher surface available across concurrent cold instances", async () => {
    const opened = structured(await callInFreshInstance("open_ketcher", {
      structure: { format: "smiles", content: "CCO" },
    }));
    const surfaceId = String(opened.surfaceId);

    const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      callInFreshInstance("control_ketcher", action(
        surfaceId,
        `cold-get-${index}`,
        "get_structure",
        1,
        { formats: ["smiles"], delivery: "inline" },
      )),
    ));

    for (const result of results) {
      const output = structured(result);
      expect(output.ok).toBe(true);
      expect(asRecord(asRecord(output.result).result).formats).toEqual({ smiles: "CCO" });
    }
  }, 30_000);
});
