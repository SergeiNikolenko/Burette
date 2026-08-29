import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
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

function oneAtomMolFixture(symbol: string) {
  return [
    "",
    "  Burette",
    "",
    "  1  0  0  0  0  0            999 V2000",
    `    0.0000    0.0000    0.0000 ${symbol.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
    "M  END",
  ].join("\n");
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
  environment: Record<string, string> = {},
): Promise<CallToolResult> {
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("./review-case-instance.ts", import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      ...environment,
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

async function startSharedRedisRest() {
  const values = new Map<string, string>();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        const command = JSON.parse(body) as string[];
        let result: unknown;
        if (command[0] === "SET" && command.includes("NX")) {
          if (values.has(command[1])) result = null;
          else {
            values.set(command[1], command[2]);
            result = "OK";
          }
        } else if (command[0] === "GET") {
          result = values.get(command[1]) ?? null;
        } else if (command[0] === "EVAL") {
          const key = command[3];
          if (values.get(key) !== command[4]) result = 0;
          else {
            values.set(key, command[5]);
            result = 1;
          }
        } else {
          throw new Error(`Unexpected Redis command ${command[0]}`);
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result }));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid command" }));
      }
    });
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Shared Redis test server did not bind a TCP port.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
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
    expect(String(getFormats.description)).toContain("current representation");
    expect(asRecord(getFormats.items).enum).toEqual([
      "ket", "mol", "rxn", "sdf", "smiles", "reaction_smiles", "cdxml",
    ]);
    expect(asRecord(asRecord(getStructure.properties).delivery).enum).toEqual([
      "inline", "artifact", "download",
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

  test("keeps aromatic SMILES and referenced KET summaries correct through tools/call", async () => {
    const benzene = structured(await rawToolCall("open_ketcher", {
      structure: { format: "smiles", content: "c1ccccc1" },
    }));
    expect(asRecord(asRecord(benzene.ketcher).structure)).toMatchObject({
      kind: "molecule",
      atomCount: 6,
      bondCount: 6,
      componentCount: 1,
    });
    const highlighted = structured(await rawToolCall("control_ketcher", action(
      String(benzene.surfaceId),
      String(benzene.continuationToken),
      "review-highlight-aromatic",
      "highlight_atoms",
      1,
      { indexes: [5] },
    )));
    expect(asRecord(highlighted.snapshot).highlightedAtoms).toEqual([5]);

    const ket = structured(await rawToolCall("open_ketcher", {
      structure: {
        format: "ket",
        content: JSON.stringify({
          root: { nodes: [{ $ref: "mol0" }] },
          mol0: {
            type: "molecule",
            atoms: [
              { label: "C", location: [0, 0, 0] },
              { label: "O", location: [1.5, 0, 0] },
            ],
            bonds: [{ type: 1, atoms: [0, 1] }],
          },
        }),
      },
    }));
    expect(asRecord(asRecord(ket.ketcher).structure)).toMatchObject({
      kind: "molecule",
      atomCount: 2,
      bondCount: 1,
      componentCount: 1,
    });

    const smiles = structured(await rawToolCall("open_ketcher", {
      structure: { format: "smiles", content: "CCO" },
    }));
    const unavailableConversion = await rawToolCall("control_ketcher", action(
      String(smiles.surfaceId),
      String(smiles.continuationToken),
      "review-unavailable-conversion",
      "get_structure",
      1,
      { formats: ["mol"], delivery: "inline" },
    ));
    expect(unavailableConversion.isError).toBe(true);
    expect(asRecord(asRecord(unavailableConversion.structuredContent).error).code).toBe("EXPORT_FAILED");
    for (const delivery of ["artifact", "download"]) {
      const unavailableDelivery = await rawToolCall("control_ketcher", action(
        String(smiles.surfaceId),
        String(smiles.continuationToken),
        `review-unavailable-${delivery}`,
        "get_structure",
        1,
        { formats: ["smiles"], delivery },
      ));
      expect(unavailableDelivery.isError).toBe(true);
      expect(asRecord(asRecord(unavailableDelivery.structuredContent).error).code).toBe("EXPORT_FAILED");
      expect(asRecord(unavailableDelivery.structuredContent).continuationToken).toBe(smiles.continuationToken);
    }
    const recoveredSmiles = structured(await rawToolCall("control_ketcher", action(
      String(smiles.surfaceId),
      String(smiles.continuationToken),
      "review-smiles-after-failure",
      "get_structure",
      1,
      { formats: ["smiles"], delivery: "inline" },
    )));
    expect(asRecord(asRecord(recoveredSmiles.result).result).formats).toEqual({ smiles: "CCO" });

    const mol = [
      "CO",
      "  Burette",
      "",
      "  2  1  0  0  0  0            999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  END",
    ].join("\n");
    const molSurface = structured(await rawToolCall("open_ketcher", {
      structure: { format: "mol", content: mol },
    }));
    const sdf = structured(await rawToolCall("control_ketcher", action(
      String(molSurface.surfaceId),
      String(molSurface.continuationToken),
      "review-mol-to-sdf",
      "get_structure",
      1,
      { formats: ["sdf"], delivery: "inline" },
    )));
    expect(asRecord(asRecord(sdf.result).result).formats).toEqual({ sdf: `${mol}\n$$$$\n` });

    const rxn = ["$RXN", "", "", "", "  1  1", "$MOL", oneAtomMolFixture("C"), "$MOL", oneAtomMolFixture("O")].join("\n");
    const rxnSurface = structured(await rawToolCall("open_ketcher", {
      structure: { format: "rxn", content: rxn },
    }));
    expect(asRecord(rxnSurface.ketcher).structure).toMatchObject({ kind: "reaction" });
    expect(asRecord(rxnSurface.ketcher).structureRevision).toBe(1);
    const exportedRxn = structured(await rawToolCall("control_ketcher", action(
      String(rxnSurface.surfaceId),
      String(rxnSurface.continuationToken),
      "review-rxn-round-trip",
      "get_structure",
      1,
      { formats: ["rxn"], delivery: "inline" },
    )));
    expect(asRecord(asRecord(exportedRxn.result).result).formats).toEqual({ rxn });

    const molLines = mol.split("\n");
    molLines[2] = "x".repeat(64 * 1024 - new TextEncoder().encode(mol).byteLength);
    const boundaryMol = molLines.join("\n");
    expect(new TextEncoder().encode(boundaryMol).byteLength).toBe(64 * 1024);
    const boundarySurface = structured(await rawToolCall("open_ketcher", {
      structure: { format: "mol", content: boundaryMol },
    }));
    const oversizedSdf = await rawToolCall("control_ketcher", action(
      String(boundarySurface.surfaceId),
      String(boundarySurface.continuationToken),
      "review-oversized-sdf",
      "get_structure",
      1,
      { formats: ["sdf"], delivery: "inline" },
    ));
    expect(oversizedSdf.isError).toBe(true);
    expect(asRecord(asRecord(oversizedSdf.structuredContent).error).code).toBe("PAYLOAD_TOO_LARGE");
    const clearedBoundary = structured(await rawToolCall("control_ketcher", action(
      String(boundarySurface.surfaceId),
      String(boundarySurface.continuationToken),
      "review-clear-after-oversized-sdf",
      "clear_structure",
      1,
    )));
    expect(asRecord(clearedBoundary.snapshot).structure).toMatchObject({ kind: "empty", atomCount: 0 });
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

  test("rejects invalid chemical content through tools/call without consuming valid state", async () => {
    for (const structure of [
      { format: "smiles", content: "foo" },
      { format: "smiles", content: "é" },
      { format: "smiles", content: "[" },
      { format: "smiles", content: "C(" },
      { format: "smiles", content: "C()" },
      { format: "smiles", content: "C==C" },
      { format: "smiles", content: "C##C" },
      { format: "smiles", content: "C1.C1" },
      { format: "ket", content: "{}" },
      { format: "ket", content: JSON.stringify({ root: { nodes: [{ $ref: "missing" }] } }) },
      { format: "ket", content: JSON.stringify({ root: { nodes: [{ $ref: "__proto__" }] } }) },
      {
        format: "ket",
        content: JSON.stringify({
          root: { nodes: [{ $ref: "mol0" }] },
          mol0: { type: "molecule", atoms: "invalid" },
        }),
      },
      { format: "ket", content: JSON.stringify({ root: { nodes: [{ type: "unknown" }] } }) },
      {
        format: "ket",
        content: JSON.stringify({
          root: { nodes: [{ $ref: "mol0" }] },
          mol0: { type: "molecule", atoms: [{ label: "C" }], bonds: [{ atoms: [0, 0] }] },
        }),
      },
      { format: "mol", content: "invalid mol" },
      { format: "mol", content: "valid-looking\nJUNKM  END" },
      { format: "mol", content: "valid-looking\nM  END\nJUNK\nM  END" },
      { format: "mol", content: oneAtomMolFixture("C").replace("\nM  END", "\nJUNK\nM  END") },
      { format: "mol", content: oneAtomMolFixture("C").replace("\nM  END", "\nM  JUNK\nM  END") },
      { format: "rxn", content: "$RXN\n\n\n\n  0  0\nJUNK" },
      { format: "rxn", content: "$RXN\n\n\n\n  1  0\n$MOL\nvalid-looking\nM  END\nJUNK\nM  END" },
    ]) {
      const rejected = await rawToolCall("open_ketcher", { structure });
      expect(rejected.isError).toBe(true);
      expect(asRecord(asRecord(rejected.structuredContent).error).code).toBe("INVALID_STRUCTURE");
    }

    const opened = structured(await rawToolCall("open_ketcher", {
      structure: { format: "smiles", content: "CCO" },
    }));
    const invalidEdit = await rawToolCall("control_ketcher", action(
      String(opened.surfaceId),
      String(opened.continuationToken),
      "route-invalid-edit",
      "set_structure",
      1,
      { format: "smiles", content: "foo" },
    ));
    expect(invalidEdit.isError).toBe(true);
    expect(asRecord(asRecord(invalidEdit.structuredContent).error).code).toBe("INVALID_STRUCTURE");
    const recovered = structured(await rawToolCall("control_ketcher", action(
      String(opened.surfaceId),
      String(opened.continuationToken),
      "route-after-invalid-edit",
      "highlight_atoms",
      1,
      { indexes: [2] },
    )));
    expect(asRecord(recovered.snapshot).highlightedAtoms).toEqual([2]);

    for (const [format, content] of [
      ["mol", "invalid mol"],
      ["rxn", "$RXN\n\n\n\n  0  0\nJUNK"],
    ] as const) {
      const recoverySurface = structured(await rawToolCall("open_ketcher", {
        structure: { format: "smiles", content: "CCO" },
      }));
      const rejectedReplacement = await rawToolCall("control_ketcher", action(
        String(recoverySurface.surfaceId),
        String(recoverySurface.continuationToken),
        `route-invalid-${format}`,
        "set_structure",
        1,
        { format, content },
      ));
      expect(rejectedReplacement.isError).toBe(true);
      expect(asRecord(asRecord(rejectedReplacement.structuredContent).error).code).toBe("INVALID_STRUCTURE");
      const cleared = structured(await rawToolCall("control_ketcher", action(
        String(recoverySurface.surfaceId),
        String(recoverySurface.continuationToken),
        `route-recover-${format}`,
        "clear_structure",
        1,
      )));
      expect(asRecord(cleared.snapshot).structure).toMatchObject({ kind: "empty", atomCount: 0 });
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
    const ketPayloadAtByteLength = (byteLength: number) => {
      const prefix = '{"root":{"nodes":[]},"note":"';
      const suffix = '"}';
      const fixedBytes = new TextEncoder().encode(prefix + suffix).byteLength;
      const remaining = byteLength - fixedBytes;
      return `${prefix}${"é".repeat(Math.floor(remaining / 2))}${remaining % 2 ? "x" : ""}${suffix}`;
    };
    const validBoundaryContent = ketPayloadAtByteLength(64 * 1024);
    expect(new TextEncoder().encode(validBoundaryContent).byteLength).toBe(64 * 1024);
    const validBoundary = await rawToolCall("control_ketcher", action(
      surfaceId,
      continuationToken,
      "utf8-boundary",
      "set_structure",
      1,
      { format: "ket", content: validBoundaryContent },
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
        format: "ket", content: ketPayloadAtByteLength(64 * 1024 + 1),
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

  test("carries one Ketcher surface through independent cold instances", async () => {
    const opened = structured(await callInFreshInstance("open_ketcher", {
      structure: { format: "smiles", content: "CCO" },
    }));
    const surfaceId = String(opened.surfaceId);
    expect(opened.continuationToken).toBeString();
    const continuationToken = String(opened.continuationToken);

    const output = structured(await callInFreshInstance("control_ketcher", action(
      surfaceId,
      continuationToken,
      "cold-get",
      "get_structure",
      1,
      { formats: ["smiles"], delivery: "inline" },
    )));
    expect(output.ok).toBe(true);
    expect(output.continuationToken).toBeString();
    expect(asRecord(asRecord(output.result).result).formats).toEqual({ smiles: "CCO" });
  }, 30_000);

  test("serializes concurrent cold instances through one shared Redis REST CAS", async () => {
    const redis = await startSharedRedisRest();
    const environment = {
      NODE_ENV: "production",
      PUBLIC_APP_ORIGIN: "https://burette-plugin.vercel.app",
      KETCHER_STATE_SECRET: "shared-cas-review-secret",
      KETCHER_CAS_REDIS_REST_URL: "https://redis.example",
      KETCHER_CAS_REDIS_REST_TOKEN: "test-token",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      BURETTE_REVIEW_REDIS_PROXY_URL: redis.url,
    };
    try {
      const opened = structured(await callInFreshInstance("open_ketcher", {
        structure: { format: "smiles", content: "CCO" },
      }, environment));
      const surfaceId = String(opened.surfaceId);
      const continuationToken = String(opened.continuationToken);
      const conflicting = await Promise.all([
        ["cold-conflict-1", "CCN"],
        ["cold-conflict-2", "CCC"],
        ["cold-conflict-3", "CCCl"],
        ["cold-conflict-4", "CCBr"],
      ].map(([actionId, content]) => callInFreshInstance("control_ketcher", action(
        surfaceId,
        continuationToken,
        actionId,
        "set_structure",
        1,
        { format: "smiles", content },
      ), environment)));
      const conflictingOutputs = conflicting.map((result) => asRecord(result.structuredContent));
      const winners = conflictingOutputs.filter((output) => output.ok === true);
      const losers = conflictingOutputs.filter((output) => output.ok === false);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(3);
      for (const loser of losers) {
        expect(asRecord(loser.error).code).toBe("REVISION_CONFLICT");
        expect(loser.continuationToken).toBeUndefined();
        expect(loser.snapshot).toBeNull();
      }

      const replayOpened = structured(await callInFreshInstance("open_ketcher", {
        structure: { format: "smiles", content: "CCO" },
      }, environment));
      const replayAction = action(
        String(replayOpened.surfaceId),
        String(replayOpened.continuationToken),
        "cold-replay",
        "set_structure",
        1,
        { format: "smiles", content: "CCN" },
      );
      const replayResults = await Promise.all(Array.from({ length: 4 }, () =>
        callInFreshInstance("control_ketcher", replayAction, environment)));
      const replayOutputs = replayResults.map(structured);
      expect(new Set(replayOutputs.map((output) => output.continuationToken)).size).toBe(1);
      const successorToken = String(replayOutputs[0].continuationToken);
      const successor = structured(await callInFreshInstance("control_ketcher", action(
        String(replayOpened.surfaceId),
        successorToken,
        "cold-successor-get",
        "get_structure",
        2,
        { formats: ["smiles"], delivery: "inline" },
      ), environment));
      expect(asRecord(successor.snapshot).structureRevision).toBe(2);
      expect(asRecord(asRecord(successor.result).result).formats).toEqual({ smiles: "CCN" });
    } finally {
      await redis.close();
    }
  }, 30_000);
});
