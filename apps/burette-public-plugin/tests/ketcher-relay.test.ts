import { describe, expect, test } from "bun:test";
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
});
