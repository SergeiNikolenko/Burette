import { describe, expect, test } from "bun:test";
import vm from "node:vm";
import * as OCL from "openchemlib";
import { KETCHER_AGENT_API_VERSION } from "@burette/ketcher-agent-contract";
import { ketcherToolMeta } from "../lib/contracts";
import {
  createHostedKetcherSurface,
  executeHostedKetcherAction,
  hostedKetcherSnapshot,
} from "../lib/ketcher-relay";
import {
  RedisRestKetcherMutationCas,
  type KetcherMutationCas,
} from "../lib/ketcher-mutation-cas";
import {
  createKetcherContinuationPayload,
  encodeKetcherContinuation,
} from "../lib/ketcher-state-token";
import {
  KETCHER_RESOURCE_URI,
  createKetcherResourceMeta,
  createKetcherWidgetHtml,
} from "../lib/widget";

function action(
  surfaceId: string,
  continuationToken: string,
  actionId: string,
  expectedRevision: number,
  extra: Record<string, unknown>,
) {
  return {
    apiVersion: KETCHER_AGENT_API_VERSION,
    type: "control_ketcher",
    surfaceId,
    continuationToken,
    actionId,
    expectedRevision,
    ...extra,
  };
}

describe("hosted Ketcher relay", () => {
  test("keeps edits revisioned, bounded, and idempotent", async () => {
    const created = createHostedKetcherSurface({ format: "smiles", content: "CCO" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const surfaceId = created.surface.surfaceId;
    const initialToken = created.continuationToken;
    expect(initialToken).toBeString();
    expect(hostedKetcherSnapshot(initialToken)?.structureRevision).toBe(1);
    expect(hostedKetcherSnapshot(initialToken)?.dirty).toBe(false);
    expect(hostedKetcherSnapshot(initialToken)?.lastAction).toBeNull();

    const setResult = await executeHostedKetcherAction(action(surfaceId, initialToken, "set-1", 1, {
      command: "set_structure",
      format: "smiles",
      content: "CCN",
    }));
    expect(setResult.ok).toBe(true);
    expect(setResult.snapshot?.structureRevision).toBe(2);
    expect(setResult.result?.ketcherSeed).toEqual({
      surfaceId,
      format: "smiles",
      content: "CCN",
    });
    expect(setResult.continuationToken).toBeString();

    const replay = await executeHostedKetcherAction(action(
      surfaceId,
      setResult.continuationToken!,
      "set-1",
      1,
      {
        command: "set_structure",
        format: "smiles",
        content: "CCN",
      },
    ));
    expect(replay.ok).toBe(true);
    expect(replay.continuationToken).toBe(setResult.continuationToken);
    expect(replay.snapshot?.structureRevision).toBe(2);
    expect(replay.result).toEqual(setResult.result);

    const replayConflict = await executeHostedKetcherAction(action(
      surfaceId,
      replay.continuationToken!,
      "set-1",
      1,
      {
        command: "set_structure",
        format: "smiles",
        content: "CCC",
      },
    ));
    expect(replayConflict.ok).toBe(false);
    expect(replayConflict.error?.code).toBe("REPLAY_CONFLICT");
    expect(replayConflict.continuationToken).toBe(replay.continuationToken);

    const highlight = await executeHostedKetcherAction(action(
      surfaceId,
      replayConflict.continuationToken!,
      "highlight-1",
      2,
      {
        command: "highlight_atoms",
        indexes: [2, 0],
      },
    ));
    expect(highlight.ok).toBe(true);
    expect(highlight.snapshot?.highlightedAtoms).toEqual([0, 2]);
    expect(highlight.snapshot?.structureRevision).toBe(2);
    expect(highlight.snapshot?.interactionRevision).toBe(3);
    expect(highlight.result?.ketcherSeed).toEqual(setResult.result?.ketcherSeed);

    const exportResult = await executeHostedKetcherAction(action(
      surfaceId,
      highlight.continuationToken!,
      "get-1",
      2,
      {
        command: "get_structure",
        formats: ["smiles"],
        delivery: "inline",
      },
    ));
    expect(exportResult.ok).toBe(true);
    expect(exportResult.result?.formats).toEqual({ smiles: "CCN" });
    expect(exportResult.result?.ketcherSeed).toEqual(setResult.result?.ketcherSeed);
    expect(exportResult.snapshot?.structureRevision).toBe(2);
    expect(exportResult.snapshot?.interactionRevision).toBe(4);

    const exportReplay = await executeHostedKetcherAction(action(
      surfaceId,
      exportResult.continuationToken!,
      "get-1",
      2,
      {
        command: "get_structure",
        formats: ["smiles"],
        delivery: "inline",
      },
    ));
    expect(exportReplay.result).toEqual(exportResult.result);
    expect(exportReplay.snapshot?.interactionRevision).toBe(4);

    const persistResult = await executeHostedKetcherAction(action(
      surfaceId,
      exportResult.continuationToken!,
      "persist-1",
      2,
      {
        command: "request_persist",
        format: "smiles",
        suggestedBasename: "edited-structure",
      },
    ));
    expect(persistResult.ok).toBe(true);
    expect(persistResult.snapshot?.structureRevision).toBe(2);
    expect(persistResult.snapshot?.interactionRevision).toBe(5);

    const persistReplay = await executeHostedKetcherAction(action(
      surfaceId,
      persistResult.continuationToken!,
      "persist-1",
      2,
      {
        command: "request_persist",
        format: "smiles",
        suggestedBasename: "edited-structure",
      },
    ));
    expect(persistReplay.result).toEqual(persistResult.result);
    expect(persistReplay.snapshot?.interactionRevision).toBe(5);

    const stale = await executeHostedKetcherAction(action(
      surfaceId,
      exportResult.continuationToken!,
      "stale-1",
      1,
      { command: "clear_structure" },
    ));
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("REVISION_CONFLICT");

    const badIndex = await executeHostedKetcherAction(action(
      surfaceId,
      stale.continuationToken!,
      "highlight-2",
      2,
      {
        command: "highlight_atoms",
        indexes: [3],
      },
    ));
    expect(badIndex.ok).toBe(false);
    expect(badIndex.error?.code).toBe("INVALID_ATOM_INDEX");
  });

  test("summarizes aromatic SMILES and referenced KET molecules for model-visible state", async () => {
    const benzene = createHostedKetcherSurface({ format: "smiles", content: "c1ccccc1" });
    expect(benzene.ok).toBe(true);
    if (!benzene.ok) return;
    expect(benzene.snapshot.structure).toMatchObject({
      kind: "molecule",
      atomCount: 6,
      bondCount: 6,
      componentCount: 1,
    });
    const highlightedBenzene = await executeHostedKetcherAction(action(
      benzene.surface.surfaceId,
      benzene.continuationToken,
      "highlight-aromatic",
      1,
      { command: "highlight_atoms", indexes: [5] },
    ));
    expect(highlightedBenzene.ok).toBe(true);
    expect(highlightedBenzene.snapshot?.highlightedAtoms).toEqual([5]);

    const branched = createHostedKetcherSurface({ format: "smiles", content: "CC(C)C" });
    expect(branched.ok).toBe(true);
    if (!branched.ok) return;
    expect(branched.snapshot.structure).toMatchObject({
      atomCount: 4,
      bondCount: 3,
      componentCount: 1,
    });

    const disconnected = createHostedKetcherSurface({ format: "smiles", content: "[Na+].[Cl-]" });
    expect(disconnected.ok).toBe(true);
    if (!disconnected.ok) return;
    expect(disconnected.snapshot.structure).toMatchObject({
      atomCount: 2,
      bondCount: 0,
      componentCount: 2,
    });

    const ket = createHostedKetcherSurface({
      format: "ket",
      content: JSON.stringify({
        root: { nodes: [{ $ref: "mol0" }] },
        mol0: {
          type: "molecule",
          atoms: [{ label: "C" }, { label: "O" }],
          bonds: [{ type: 1, atoms: [0, 1] }],
        },
      }),
    });
    expect(ket.ok).toBe(true);
    if (!ket.ok) return;
    expect(ket.snapshot.structure).toMatchObject({
      kind: "molecule",
      atomCount: 2,
      bondCount: 1,
      componentCount: 1,
    });
    const highlightedKet = await executeHostedKetcherAction(action(
      ket.surface.surfaceId,
      ket.continuationToken,
      "highlight-ket",
      1,
      { command: "highlight_atoms", indexes: [1] },
    ));
    expect(highlightedKet.ok).toBe(true);
    expect(highlightedKet.snapshot?.highlightedAtoms).toEqual([1]);
  });

  test("exports only representations the hosted relay can produce", async () => {
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
    const createdMol = createHostedKetcherSurface({ format: "mol", content: mol });
    expect(createdMol.ok).toBe(true);
    if (!createdMol.ok) return;
    const sdf = await executeHostedKetcherAction(action(
      createdMol.surface.surfaceId,
      createdMol.continuationToken,
      "export-sdf",
      1,
      { command: "get_structure", formats: ["sdf"], delivery: "inline" },
    ));
    expect(sdf.ok).toBe(true);
    expect(sdf.result?.formats).toEqual({ sdf: `${mol}\n$$$$\n` });

    const createdSmiles = createHostedKetcherSurface({ format: "smiles", content: "CCO" });
    expect(createdSmiles.ok).toBe(true);
    if (!createdSmiles.ok) return;
    const unavailableDelivery = await executeHostedKetcherAction(action(
      createdSmiles.surface.surfaceId,
      createdSmiles.continuationToken,
      "export-artifact-unavailable",
      1,
      { command: "get_structure", formats: ["smiles"], delivery: "artifact" },
    ));
    expect(unavailableDelivery.ok).toBe(false);
    expect(unavailableDelivery.error?.code).toBe("EXPORT_FAILED");
  });

  test("rejects invalid chemical content before issuing or advancing state", async () => {
    for (const content of ["foo", "é", "[", "C(", "C()", "C==C", "C##C", "C1.C1"]) {
      const invalidSmiles = createHostedKetcherSurface({ format: "smiles", content });
      expect(invalidSmiles.ok).toBe(false);
      if (invalidSmiles.ok) return;
      expect(invalidSmiles.error.code).toBe("INVALID_STRUCTURE");
    }
    for (const content of [
      "{}",
      JSON.stringify({ root: { nodes: [{ $ref: "missing" }] } }),
      JSON.stringify({ root: { nodes: [{ $ref: "__proto__" }] } }),
      JSON.stringify({ root: { nodes: [{ $ref: "mol0" }] }, mol0: { type: "molecule", atoms: "invalid" } }),
      JSON.stringify({ root: { nodes: [{ type: "unknown" }] } }),
      JSON.stringify({
        root: { nodes: [{ $ref: "mol0" }] },
        mol0: { type: "molecule", atoms: [{ label: "C" }], bonds: [{ atoms: [0, 0] }] },
      }),
    ]) {
      const invalidKet = createHostedKetcherSurface({ format: "ket", content });
      expect(invalidKet.ok).toBe(false);
      if (invalidKet.ok) return;
      expect(invalidKet.error.code).toBe("INVALID_STRUCTURE");
    }
    const rgroupKet = JSON.stringify({ root: { nodes: [{ type: "rgroup", data: { rgnumber: 1 } }] } });
    expect(createHostedKetcherSurface({ format: "ket", content: rgroupKet }).ok).toBe(true);
    const v3000Mol = OCL.Molecule.fromSmiles("CO").toMolfileV3();
    expect(createHostedKetcherSurface({ format: "mol", content: v3000Mol }).ok).toBe(true);
    for (const content of [
      v3000Mol.replace("COUNTS 2 1", "COUNTS 3 1"),
      v3000Mol.replace("M  V30 BEGIN ATOM", "M  V30 COUNTS 2 1 0 0 0\nM  V30 BEGIN ATOM"),
      v3000Mol.replace("M  END", "M  V30 JUNK\nM  END"),
    ]) {
      expect(createHostedKetcherSurface({ format: "mol", content }).ok).toBe(false);
    }
    const v3000Rxn = OCL.Reaction.fromSmiles("C>>O").toRxnV3();
    expect(createHostedKetcherSurface({ format: "rxn", content: v3000Rxn }).ok).toBe(true);
    expect(createHostedKetcherSurface({
      format: "rxn",
      content: v3000Rxn.replace("M  END", "M  V30 JUNK\nM  END"),
    }).ok).toBe(false);
    for (const input of [
      { format: "mol" as const, content: "invalid mol" },
      { format: "mol" as const, content: "valid-looking\nJUNKM  END" },
      { format: "mol" as const, content: "valid-looking\nM  END\nJUNK\nM  END" },
      { format: "rxn" as const, content: "$RXN\n\n\n\n  0  0\nJUNK" },
      { format: "rxn" as const, content: "$RXN\n\n\n\n  1  0\n$MOL\nvalid-looking\nM  END\nJUNK\nM  END" },
    ]) {
      const invalid = createHostedKetcherSurface(input);
      expect(invalid.ok).toBe(false);
      if (invalid.ok) return;
      expect(invalid.error.code).toBe("INVALID_STRUCTURE");
    }

    for (const content of ["[Mo]$[Mo]", "C%(100)CCCCC%(100)", "CCO\n"]) {
      expect(createHostedKetcherSurface({ format: "smiles", content }).ok).toBe(true);
    }

    const created = createHostedKetcherSurface({ format: "smiles", content: "CCO" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rejectedEdit = await executeHostedKetcherAction(action(
      created.surface.surfaceId,
      created.continuationToken,
      "invalid-edit",
      1,
      { command: "set_structure", format: "smiles", content: "foo" },
    ));
    expect(rejectedEdit.ok).toBe(false);
    expect(rejectedEdit.error?.code).toBe("INVALID_STRUCTURE");
    expect(rejectedEdit.snapshot?.structure).toMatchObject({ atomCount: 3, bondCount: 2 });
    const recovered = await executeHostedKetcherAction(action(
      created.surface.surfaceId,
      created.continuationToken,
      "after-invalid-edit",
      1,
      { command: "highlight_atoms", indexes: [2] },
    ));
    expect(recovered.ok).toBe(true);
    expect(recovered.snapshot?.highlightedAtoms).toEqual([2]);
  });

  test("lets an older invalid seed recover through clear or replacement", async () => {
    const surfaceId = "hosted-ketcher:legacy-invalid";
    const legacyPayload = createKetcherContinuationPayload({
      surfaceId,
      state: {
        surfaceId,
        phase: "ready",
        structureRevision: 1,
        interactionRevision: 1,
        persistedRevision: 1,
        dirty: false,
      },
      input: { format: "smiles", content: "foo" },
      selectedAtoms: [],
      highlightedAtoms: [],
      lastAction: null,
    });
    const cleared = await executeHostedKetcherAction(action(
      surfaceId,
      encodeKetcherContinuation(legacyPayload),
      "legacy-clear",
      1,
      { command: "clear_structure" },
    ));
    expect(cleared.ok).toBe(true);
    expect(cleared.snapshot?.structure).toMatchObject({ kind: "empty", atomCount: 0 });

    const replaced = await executeHostedKetcherAction(action(
      surfaceId,
      encodeKetcherContinuation(legacyPayload),
      "legacy-replace",
      1,
      { command: "set_structure", format: "smiles", content: "CCN" },
    ));
    expect(replaced.ok).toBe(true);
    expect(replaced.snapshot?.structure).toMatchObject({ atomCount: 3, bondCount: 2 });
  });

  test("fails closed for unresolved hosted references", async () => {
    const created = createHostedKetcherSurface();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await executeHostedKetcherAction(action(
      created.surface.surfaceId,
      created.continuationToken,
      "ref-1",
      0,
      {
        command: "set_structure",
        format: "mol",
        contentRef: "artifact://not-configured",
      },
    ));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TRANSPORT_UNAVAILABLE");
  });

  test("allows only one concurrent mutation from the same token across relay instances", async () => {
    const redis = fakeRedisRest();
    const firstInstance = new RedisRestKetcherMutationCas({
      url: "https://redis.example",
      token: "test-token",
      fetcher: redis.fetch,
    });
    const secondInstance = new RedisRestKetcherMutationCas({
      url: "https://redis.example",
      token: "test-token",
      fetcher: redis.fetch,
    });
    const created = createHostedKetcherSurface({ format: "smiles", content: "CCO" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [first, second] = await Promise.all([
      executeHostedKetcherAction(action(
        created.surface.surfaceId,
        created.continuationToken,
        "concurrent-1",
        1,
        { command: "set_structure", format: "smiles", content: "CCN" },
      ), { cas: firstInstance }),
      executeHostedKetcherAction(action(
        created.surface.surfaceId,
        created.continuationToken,
        "concurrent-2",
        1,
        { command: "set_structure", format: "smiles", content: "CCC" },
      ), { cas: secondInstance }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const conflict = first.ok ? second : first;
    expect(conflict.error?.code).toBe("REVISION_CONFLICT");
    expect(conflict.continuationToken).toBeUndefined();
    expect(conflict.snapshot).toBeUndefined();
  });

  test("recovers a pending claim after a crash without forking concurrent retries", async () => {
    const redis = fakeRedisRest();
    const sharedCas = () => new RedisRestKetcherMutationCas({
      url: "https://redis.example",
      token: "test-token",
      fetcher: redis.fetch,
    });
    const claimedCas = sharedCas();
    let crashAfterClaim = true;
    const crashingCas: KetcherMutationCas = {
      claim: (...args) => claimedCas.claim(...args),
      complete: (...args) => {
        if (crashAfterClaim) {
          crashAfterClaim = false;
          throw new Error("Simulated crash after claim.");
        }
        return claimedCas.complete(...args);
      },
      read: (...args) => claimedCas.read(...args),
    };
    const created = createHostedKetcherSurface({ format: "smiles", content: "CCO" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const retriedAction = action(
      created.surface.surfaceId,
      created.continuationToken,
      "recover-1",
      1,
      { command: "set_structure", format: "smiles", content: "CCN" },
    );

    const interrupted = await executeHostedKetcherAction(retriedAction, { cas: crashingCas });
    expect(interrupted.ok).toBe(false);
    expect(interrupted.error?.code).toBe("TRANSPORT_UNAVAILABLE");

    const [firstRetry, secondRetry] = await Promise.all([
      executeHostedKetcherAction(retriedAction, { cas: sharedCas() }),
      executeHostedKetcherAction(retriedAction, { cas: sharedCas() }),
    ]);
    expect(firstRetry.ok).toBe(true);
    expect(secondRetry.ok).toBe(true);
    expect(firstRetry.continuationToken).toBe(secondRetry.continuationToken);
    expect(firstRetry.snapshot?.structureRevision).toBe(2);
    expect(secondRetry.snapshot?.structureRevision).toBe(2);

    const conflict = await executeHostedKetcherAction(action(
      created.surface.surfaceId,
      created.continuationToken,
      "recover-conflict",
      1,
      { command: "set_structure", format: "smiles", content: "CCC" },
    ), { cas: sharedCas() });
    expect(conflict.ok).toBe(false);
    expect(conflict.error?.code).toBe("REVISION_CONFLICT");
    expect(conflict.continuationToken).toBeUndefined();
    expect(conflict.snapshot).toBeUndefined();
  });
});

function fakeRedisRest() {
  const values = new Map<string, string>();
  const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as string[];
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
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch };
}

describe("hosted Ketcher widget contract", () => {
  test("uses the versioned resource and same-origin CSP", () => {
    const meta = createKetcherResourceMeta("https://burette.example");
    const toolMeta = ketcherToolMeta("Opening Ketcher…", "Ketcher ready");
    expect(KETCHER_RESOURCE_URI).toBe("ui://burette/ketcher-editor-v1.html");
    expect("resourceUri" in meta.ui).toBe(false);
    expect(meta.ui.domain).toBe("https://burette.example");
    expect(meta.ui.csp.connectDomains).toEqual(["https://burette.example"]);
    expect(meta["openai/widgetDescription"]).toContain("Ketcher");
    expect(toolMeta.ui.resourceUri).toBe(KETCHER_RESOURCE_URI);
    expect(toolMeta["openai/widgetAccessible"]).toBe(true);
  });

  test("bootstraps the hosted seed bridge without widening the payload path", () => {
    const html = createKetcherWidgetHtml("https://burette.example");
    expect(html).toContain("__BURETTE_HOSTED_KETCHER_WIDGET__");
    expect(html).toContain("__BURETTE_HOSTED_KETCHER_RESULTS__");
    expect(html).toContain("burette-ketcher-result");
    expect(html).not.toContain('new CustomEvent("burette-ketcher-seed")');
    expect(html).not.toContain('new CustomEvent("burette-ketcher-state")');
    expect(html).toContain("ketcherState");
    expect(html).toContain("callServerTool");
    expect(html).toContain("/viewer-shell/assets/burette-hosted-shell.js");
    expect(html).not.toContain("contentRef");
  });

  test("accepts Ketcher seed metadata from the MCP Apps result envelope", () => {
    const html = createKetcherWidgetHtml("https://burette.example");
    const source = html.match(/<script>\s*([\s\S]*?)<\/script>/u)?.[1];
    expect(source).toBeTruthy();

    const toolOutput = {
      ok: true,
      ketcher: { structureRevision: 0, interactionRevision: 0 },
    };
    const toolResponseMetadata = {
      mcp_tool_result: {
        result: {
          _meta: {
            ketcherSeed: {
              surfaceId: "surface-1",
              format: "smiles",
              content: "c1ccccc1",
            },
            ketcherState: {
              surfaceId: "surface-1",
              continuationToken: "token-1",
            },
          },
        },
      },
    };
    const expectedResult = {
      state: {
        surfaceId: "surface-1",
        continuationToken: "token-1",
        snapshot: { structureRevision: 0, interactionRevision: 0 },
      },
      seed: {
        surfaceId: "surface-1",
        format: "smiles",
        content: "c1ccccc1",
      },
    };
    const createWindow = (openai?: Record<string, unknown>) => {
      const listeners = new Map<string, Array<(event: unknown) => void>>();
      const parent = {};
      const window = {
        parent,
        openai,
        addEventListener(type: string, listener: (event: unknown) => void) {
          const handlers = listeners.get(type) || [];
          handlers.push(listener);
          listeners.set(type, handlers);
        },
        dispatchEvent() {},
        dispatchOpenAI(globals: Record<string, unknown>) {
          for (const listener of listeners.get("openai:set_globals") || []) {
            listener({ detail: { globals } });
          }
        },
        dispatchMessage(data: unknown) {
          for (const listener of listeners.get("message") || []) {
            listener({ source: parent, data });
          }
        },
      } as Record<string, unknown> & {
        dispatchOpenAI: (globals: Record<string, unknown>) => void;
        dispatchMessage: (data: unknown) => void;
        __BURETTE_HOSTED_KETCHER_RESULTS__?: unknown[];
        __BURETTE_HOSTED_MCP_BRIDGE_READY__?: boolean;
      };
      vm.runInNewContext(source!, { CustomEvent: class {}, TextEncoder, window });
      return window;
    };

    const lateWindow = createWindow();
    lateWindow.__BURETTE_HOSTED_MCP_BRIDGE_READY__ = true;
    lateWindow.dispatchOpenAI({ toolOutput });
    lateWindow.dispatchOpenAI({ toolResponseMetadata });
    expect(lateWindow.__BURETTE_HOSTED_KETCHER_RESULTS__).toEqual([expectedResult]);

    const messageWindow = createWindow();
    messageWindow.dispatchMessage({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: toolOutput, _meta: toolResponseMetadata },
    });
    expect(messageWindow.__BURETTE_HOSTED_KETCHER_RESULTS__).toEqual([expectedResult]);

    const preloadedWindow = createWindow({ toolOutput, toolResponseMetadata });
    expect(preloadedWindow.__BURETTE_HOSTED_KETCHER_RESULTS__).toEqual([expectedResult]);
  });
});
