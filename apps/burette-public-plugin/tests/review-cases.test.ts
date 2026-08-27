import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { KETCHER_AGENT_API_VERSION } from "@burette/ketcher-agent-contract";
import {
  controlKetcherOutputSchema,
  openKetcherOutputSchema,
} from "../app/mcp/route";
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
  continuationToken: string,
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
      continuationToken,
      actionId,
      expectedRevision,
      ...fields,
    },
  };
}

let nextRequestId = 100;

async function rawRouteMessage(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = nextRequestId;
  nextRequestId += 1;
  const messages = await postRouteMessage({ jsonrpc: "2.0", id, method, params });
  expect(messages).toHaveLength(1);
  const message = asRecord(messages[0]);
  expect(message.id).toBe(id);
  return message;
}

async function rawRouteRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const message = await rawRouteMessage(method, params);
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

  test("publishes exact bounded Ketcher input and output unions", async () => {
    const listed = await rawRouteRequest("tools/list", {});
    const tools = (listed.tools as unknown[]).map(asRecord);
    const openTool = tools.find((candidate) => candidate.name === "open_ketcher");
    const tool = tools.find((candidate) => candidate.name === "control_ketcher");
    expect(openTool).toBeDefined();
    expect(tool).toBeDefined();

    const inputProperties = asRecord(asRecord(tool!.inputSchema).properties);
    const actionSchema = asRecord(inputProperties.action);
    const actionVariants = actionSchema.anyOf as unknown[];
    expect(actionVariants).toHaveLength(5);
    const variantSchemas = actionVariants.map(asRecord);
    expect(variantSchemas.map((variant) =>
      asRecord(asRecord(variant.properties).command).const,
    )).toEqual([
      "set_structure",
      "clear_structure",
      "highlight_atoms",
      "get_structure",
      "request_persist",
    ]);
    for (const variant of variantSchemas) {
      expect(variant.additionalProperties).toBe(false);
      expect(asRecord(asRecord(variant.properties).surfaceId).maxLength).toBe(160);
    }

    const getStructure = variantSchemas.find((variant) =>
      asRecord(asRecord(variant.properties).command).const === "get_structure"
    )!;
    const getFormats = asRecord(asRecord(getStructure.properties).formats);
    expect(getFormats).toMatchObject({ minItems: 1, maxItems: 7 });
    expect(asRecord(getFormats.items).enum).toEqual([
      "ket", "mol", "rxn", "sdf", "smiles", "reaction_smiles", "cdxml",
    ]);

    const openOutputVariants = asRecord(openTool!.outputSchema).oneOf as unknown[];
    expect(openOutputVariants).toHaveLength(2);
    for (const variant of openOutputVariants.map(asRecord)) {
      expect(variant.additionalProperties).toBe(false);
    }

    const outputVariants = asRecord(tool!.outputSchema).oneOf as unknown[];
    expect(outputVariants).toHaveLength(2);
    for (const variant of outputVariants.map(asRecord)) {
      expect(variant.additionalProperties).toBe(false);
    }
    const outputSuccess = outputVariants.map(asRecord).find((variant) =>
      asRecord(asRecord(variant.properties).ok).const === true
    )!;
    const outputSnapshot = asRecord(asRecord(outputSuccess.properties).snapshot);
    expect(asRecord(asRecord(outputSnapshot.properties).surfaceId).maxLength).toBe(160);
    const resultVariants = asRecord(asRecord(outputSuccess.properties).result).anyOf as unknown[];
    expect(resultVariants).toHaveLength(5);
    for (const variant of resultVariants.map(asRecord)) {
      expect(variant.additionalProperties).toBe(false);
    }
    const exportResult = resultVariants.map(asRecord).find((variant) =>
      asRecord(asRecord(variant.properties).command).const === "get_structure"
    )!;
    const exportFormats = asRecord(asRecord(asRecord(exportResult.properties).result).properties).formats;
    expect(Object.keys(asRecord(asRecord(exportFormats).properties)).sort()).toEqual([
      "cdxml", "ket", "mol", "reaction_smiles", "rxn", "sdf", "smiles",
    ]);
    expect(asRecord(exportFormats).additionalProperties).toBe(false);
  });

  test("rejects impossible outer Ketcher output combinations", async () => {
    const openedResult = await rawToolCall("open_ketcher", {
      structure: { format: "smiles", content: "CCO" },
    });
    const opened = asRecord(openedResult.structuredContent);
    expect(openKetcherOutputSchema.safeParse(opened).success).toBe(true);
    expect(openKetcherOutputSchema.safeParse({
      ...opened,
      error: { code: "TRANSPORT_UNAVAILABLE", message: "Impossible success/error mix." },
    }).success).toBe(false);
    expect(openKetcherOutputSchema.safeParse({
      ok: false,
      surfaceId: opened.surfaceId,
      error: { code: "TRANSPORT_UNAVAILABLE", message: "Impossible error/success mix." },
    }).success).toBe(false);

    const surfaceId = String(opened.surfaceId);
    const continuationToken = String(opened.continuationToken);
    const successResult = await rawToolCall("control_ketcher", action(
      surfaceId,
      continuationToken,
      "strict-success",
      "highlight_atoms",
      1,
      { indexes: [0] },
    ));
    const success = asRecord(successResult.structuredContent);
    expect(controlKetcherOutputSchema.safeParse(success).success).toBe(true);
    expect(controlKetcherOutputSchema.safeParse({
      ...success,
      error: { code: "REVISION_CONFLICT", message: "Impossible success/error mix." },
    }).success).toBe(false);
    expect(controlKetcherOutputSchema.safeParse({ ...success, snapshot: null }).success).toBe(false);

    const failureResult = await rawToolCall("control_ketcher", action(
      surfaceId,
      String(success.continuationToken),
      "strict-failure",
      "clear_structure",
      0,
    ));
    const failure = asRecord(failureResult.structuredContent);
    expect(failureResult.isError).toBe(true);
    expect(controlKetcherOutputSchema.safeParse(failure).success).toBe(true);
    expect(controlKetcherOutputSchema.safeParse({ ...failure, ok: true }).success).toBe(false);
    const { error: _error, ...failureWithoutError } = failure;
    expect(controlKetcherOutputSchema.safeParse(failureWithoutError).success).toBe(false);
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
          expect(output.continuationToken).toBeString();
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
    expect(opened.continuationToken).toBeString();
    const initialToken = String(opened.continuationToken);

    const setResult = await rawToolCall(
      "control_ketcher",
      action(surfaceId, initialToken, "review-set", "set_structure", 1, {
        format: "smiles",
        content: "CCN",
      }),
    );
    const set = structured(setResult);
    expect(set.continuationToken).toBeString();
    const setToken = String(set.continuationToken);

    const getResult = await rawToolCall(
      "control_ketcher",
      action(surfaceId, setToken, "review-get", "get_structure", 2, {
        formats: ["smiles"],
        delivery: "inline",
      }),
    );
    const get = structured(getResult);
    expect(get.continuationToken).toBeString();
    const getToken = String(get.continuationToken);
    const clearResult = await rawToolCall(
      "control_ketcher",
      action(surfaceId, getToken, "review-clear", "clear_structure", 2),
    );

    expect(set.ok).toBe(true);
    expect(asRecord(set.snapshot).structureRevision).toBe(2);
    expect(asRecord(asRecord(set.result).result)).toEqual({});
    expect(asRecord(asRecord(setResult._meta).ketcherSeed)).toEqual({
      surfaceId,
      format: "smiles",
      content: "CCN",
    });

    expect(asRecord(asRecord(get.result).result).formats).toEqual({ smiles: "CCN" });

    const clear = structured(clearResult);
    expect(clear.ok).toBe(true);
    expect(clear.continuationToken).toBeString();
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
      const surfaceId = String(opened.surfaceId);
      let continuationToken = String(opened.continuationToken);
      const variants = [
        ["set_structure", 1, { format: "smiles", content: "CCN" }],
        ["highlight_atoms", 2, { indexes: [0, 2] }],
        ["get_structure", 2, { formats: ["smiles"], delivery: "inline" }],
        ["request_persist", 2, { format: "smiles", suggestedBasename: "schema-review" }],
        ["clear_structure", 2, {}],
      ] as const;
      for (const [command, expectedRevision, fields] of variants) {
        const output = structured(await client.callTool({
          name: "control_ketcher",
          arguments: action(
            surfaceId,
            continuationToken,
            `schema-${command}`,
            command,
            expectedRevision,
            fields,
          ),
        }) as CallToolResult);
        expect(output.ok).toBe(true);
        expect(asRecord(output.result).command).toBe(command);
        continuationToken = String(output.continuationToken);
      }
    } finally {
      await client.close();
    }
  });

  test("rejects schema/runtime drift and enforces the inline UTF-8 byte limit", async () => {
    const opened = structured(await rawToolCall("open_ketcher", {
      structure: { format: "smiles", content: "CCO" },
    }));
    const surfaceId = String(opened.surfaceId);
    const continuationToken = String(opened.continuationToken);
    const acceptedSurfaceBoundary = await rawToolCall("control_ketcher", action(
      "x".repeat(160),
      continuationToken,
      "surface-boundary",
      "clear_structure",
      1,
    ));
    expect(acceptedSurfaceBoundary.isError).toBe(true);
    expect(asRecord(asRecord(acceptedSurfaceBoundary.structuredContent).error).code).toBe("STALE_TARGET");
    const validBoundary = await rawToolCall("control_ketcher", action(
      surfaceId,
      continuationToken,
      "utf8-boundary",
      "set_structure",
      1,
      { format: "smiles", content: "é".repeat(32_768) },
    ));
    expect(structured(validBoundary).ok).toBe(true);

    const invalidActions = [
      action(surfaceId, continuationToken, "foreign-set", "set_structure", 1, {
        format: "smiles", content: "CCN", indexes: [0],
      }),
      action(surfaceId, continuationToken, "foreign-clear", "clear_structure", 1, {
        format: "mol",
      }),
      action(surfaceId, continuationToken, "foreign-highlight", "highlight_atoms", 1, {
        indexes: [0], formats: ["smiles"],
      }),
      action(surfaceId, continuationToken, "duplicate-highlight", "highlight_atoms", 1, {
        indexes: [0, 0],
      }),
      action(surfaceId, continuationToken, "empty-formats", "get_structure", 1, {
        formats: [],
      }),
      action(surfaceId, continuationToken, "bad-format", "get_structure", 1, {
        formats: ["pdb"],
      }),
      action(surfaceId, continuationToken, "foreign-persist", "request_persist", 1, {
        format: "smiles", delivery: "inline",
      }),
      action(surfaceId, continuationToken, "mol-ref", "set_structure", 1, {
        format: "mol", contentRef: "artifact://structure",
      }),
      action("x".repeat(161), continuationToken, "surface-overflow", "clear_structure", 1),
      action(surfaceId, continuationToken, "utf8-overflow", "set_structure", 1, {
        format: "smiles", content: "é".repeat(32_769),
      }),
    ];
    for (const invalidAction of invalidActions) {
      const message = await rawRouteMessage("tools/call", {
        name: "control_ketcher",
        arguments: invalidAction,
      });
      const rejected = asRecord(message.result);
      expect(rejected.isError).toBe(true);
      expect(asRecord((rejected.content as unknown[])[0]).text).toContain("Input validation error");
    }
  });

  test("keeps one Ketcher surface available across concurrent cold instances", async () => {
    const opened = structured(await callInFreshInstance("open_ketcher", {
      structure: { format: "smiles", content: "CCO" },
    }));
    const surfaceId = String(opened.surfaceId);
    expect(opened.continuationToken).toBeString();
    const continuationToken = String(opened.continuationToken);

    const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      callInFreshInstance("control_ketcher", action(
        surfaceId,
        continuationToken,
        `cold-get-${index}`,
        "get_structure",
        1,
        { formats: ["smiles"], delivery: "inline" },
      )),
    ));

    for (const result of results) {
      const output = structured(result);
      expect(output.ok).toBe(true);
      expect(output.continuationToken).toBeString();
      expect(asRecord(asRecord(output.result).result).formats).toEqual({ smiles: "CCO" });
    }
  }, 30_000);
});
