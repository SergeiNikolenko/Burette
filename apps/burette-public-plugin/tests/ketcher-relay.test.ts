import { describe, expect, test } from "bun:test";
import { KETCHER_AGENT_API_VERSION } from "@burette/ketcher-agent-contract";
import { ketcherToolMeta } from "../lib/contracts";
import {
  createHostedKetcherSurface,
  executeHostedKetcherAction,
  hostedKetcherSnapshot,
} from "../lib/ketcher-relay";
import {
  KETCHER_RESOURCE_URI,
  createKetcherResourceMeta,
  createKetcherWidgetHtml,
} from "../lib/widget";

function action(surfaceId: string, actionId: string, expectedRevision: number, extra: Record<string, unknown>) {
  return {
    apiVersion: KETCHER_AGENT_API_VERSION,
    type: "control_ketcher",
    surfaceId,
    actionId,
    expectedRevision,
    ...extra,
  };
}

describe("hosted Ketcher relay", () => {
  test("keeps edits revisioned, bounded, and idempotent", () => {
    const created = createHostedKetcherSurface({ format: "smiles", content: "CCO" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const surfaceId = created.surface.surfaceId;
    expect(hostedKetcherSnapshot(surfaceId)?.structureRevision).toBe(1);
    expect(hostedKetcherSnapshot(surfaceId)?.dirty).toBe(false);
    expect(hostedKetcherSnapshot(surfaceId)?.lastAction).toBeNull();

    const setResult = executeHostedKetcherAction(action(surfaceId, "set-1", 1, {
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

    const replay = executeHostedKetcherAction(action(surfaceId, "set-1", 1, {
      command: "set_structure",
      format: "smiles",
      content: "CCN",
    }));
    expect(replay).toEqual(setResult);

    const replayConflict = executeHostedKetcherAction(action(surfaceId, "set-1", 1, {
      command: "set_structure",
      format: "smiles",
      content: "CCC",
    }));
    expect(replayConflict.ok).toBe(false);
    expect(replayConflict.error?.code).toBe("REPLAY_CONFLICT");

    const highlight = executeHostedKetcherAction(action(surfaceId, "highlight-1", 2, {
      command: "highlight_atoms",
      indexes: [2, 0],
    }));
    expect(highlight.ok).toBe(true);
    expect(highlight.snapshot?.highlightedAtoms).toEqual([0, 2]);
    expect(highlight.snapshot?.structureRevision).toBe(2);
    expect(highlight.snapshot?.interactionRevision).toBe(3);

    const exportResult = executeHostedKetcherAction(action(surfaceId, "get-1", 2, {
      command: "get_structure",
      formats: ["smiles"],
      delivery: "inline",
    }));
    expect(exportResult.ok).toBe(true);
    expect(exportResult.result?.formats).toEqual({ smiles: "CCN" });

    const stale = executeHostedKetcherAction(action(surfaceId, "stale-1", 1, {
      command: "clear_structure",
    }));
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("REVISION_CONFLICT");

    const badIndex = executeHostedKetcherAction(action(surfaceId, "highlight-2", 2, {
      command: "highlight_atoms",
      indexes: [3],
    }));
    expect(badIndex.ok).toBe(false);
    expect(badIndex.error?.code).toBe("INVALID_ATOM_INDEX");
  });

  test("fails closed for unresolved hosted references", () => {
    const created = createHostedKetcherSurface();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = executeHostedKetcherAction(action(created.surface.surfaceId, "ref-1", 0, {
      command: "set_structure",
      format: "mol",
      contentRef: "artifact://not-configured",
    }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TRANSPORT_UNAVAILABLE");
  });
});

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
    expect(html).toContain("__BURETTE_HOSTED_KETCHER_SEED__");
    expect(html).toContain("burette-ketcher-seed");
    expect(html).toContain("callServerTool");
    expect(html).toContain("/viewer-shell/assets/burette-hosted-shell.js");
    expect(html).not.toContain("contentRef");
  });
});

 test("bounds replay bytes while preserving the latest idempotent response", () => {
  const created = createHostedKetcherSurface({ format: "smiles", content: "C".repeat(60_000) });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const { surface } = created;
  for (let index = 0; index < 40; index++) {
    const request = action(surface.surfaceId, `large-${index}`, 1, {
      command: "get_structure", formats: ["smiles"], delivery: "inline",
    });
    const result = executeHostedKetcherAction(request);
    expect(result.ok).toBe(true);
    expect(surface.actionResultBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(executeHostedKetcherAction(request)).toEqual(result);
  }
  expect(surface.actionResults.size).toBeLessThan(40);
  for (const entry of surface.actionResults.values()) expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
 });


test("replays maximum JSON-escaped MOL payloads and dual exports", () => {
  const created = createHostedKetcherSurface();
  if (!created.ok) throw new Error("surface creation failed");
  const surfaceId = created.surface.surfaceId;
  const set = action(surfaceId, "escaped-set", 0, {
    command: "set_structure", format: "mol", content: "\u0001".repeat(65536),
  });
  const result = executeHostedKetcherAction(set);
  expect(result.ok).toBe(true);
  expect(executeHostedKetcherAction(set)).toEqual(result);
  const get = action(surfaceId, "escaped-export", 1, {
    command: "get_structure", formats: ["mol", "sdf"], delivery: "inline",
  });
  const exported = executeHostedKetcherAction(get);
  expect(exported.ok).toBe(true);
  expect(executeHostedKetcherAction(get)).toEqual(exported);
  expect(created.surface.actionResultBytes).toBeLessThanOrEqual(1024 * 1024);
});
