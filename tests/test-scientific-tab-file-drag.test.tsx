import { expect, test } from "bun:test";
import { act } from "react";
import {
  fixture,
  assertArchive,
  writes,
  tick,
  until,
  holdPath,
} from "./native-scientific-consumer-fixture";
import { useMoleculeStore } from "../apps/desktop/src/stores/molecule-store";
import { beginScienceSessionRestore } from "../apps/desktop/src/lib/science-session/state";
import { decodeScienceSession } from "../apps/desktop/src/lib/science-session/codec";
test("actual tab drag retains restored science, Original and logical identities after asset ACK", async () => {
  const f = await fixture();
  try {
    expect(f.reserved()).toBe(0);
    await act(async () =>
      useMoleculeStore.setState({ documents: [{ ...f.doc, sceneUnsaved: true }] }),
    );
    const payload = await f.drag();
    expect(writes.map((write) => write.command)).toEqual(["write_base64_file"]);
    expect(payload.paths).toEqual([writes[0].path]);
    await assertArchive(writes[0].bytes, f);
  } finally {
    await f.close();
  }
});
test("dirty logical SDF in an absolute clean MOLX is materialized as a valid scene archive", async () => {
  const f = await fixture("sdf");
  try {
    const edited = await f.editSdf();
    await f.drag();
    expect(writes.map((write) => write.command)).toEqual(["write_base64_file"]);
    expect(writes[0].path.endsWith(".molx")).toBe(true);
    await assertArchive(writes[0].bytes, f, edited);
  } finally {
    await f.close();
  }
});
test("pending restore cannot write, then the same drag retains restored data after completion", async () => {
  const f = await fixture("xyz", true);
  try {
    const dragging = f.drag();
    await tick();
    expect(writes).toHaveLength(0);
    expect(f.reserved()).toBeGreaterThan(0);
    await f.ready();
    await dragging;
    await assertArchive(writes[0].bytes, f);
  } finally {
    await f.close();
  }
});
for (const failure of ["corrupt", "cancelled", "replaced"] as const)
  test(`a ${failure} restore cannot materialize a tab file`, async () => {
    const f = await fixture("xyz", true);
    try {
      const dragging = f.drag();
      void dragging.catch(() => {});
      await tick();
      if (failure === "cancelled") beginScienceSessionRestore(f.doc.id);
      if (failure === "replaced") await f.replace();
      f.heldRead.resolve(
        failure === "corrupt" ? Uint8Array.of(1, 2, 3).buffer : f.bytes.slice().buffer,
      );
      await expect(dragging).rejects.toThrow();
      expect(writes).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
for (const phase of ["cacheDir", "join"] as const)
  test(`a source replacement during async ${phase} refuses the prepared file before native write`, async () => {
    const f = await fixture();
    try {
      const gate = holdPath(phase);
      const dragging = f.drag();
      void dragging.catch(() => {});
      await until(gate.entered);
      await f.replace();
      gate.release();
      await expect(dragging).rejects.toThrow();
      expect(writes).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
test("ordinary foreign scene and dirty plain source remain usable", async () => {
  let f = await fixture("foreign");
  try {
    await act(async () =>
      useMoleculeStore.setState({ documents: [{ ...f.doc, sceneUnsaved: true }] }),
    );
    await f.drag();
    expect(await decodeScienceSession(writes[0].bytes)).toBeNull();
  } finally {
    await f.close();
  }
  f = await fixture("plain");
  try {
    await act(async () => f.controller.beginEditing(f.doc));
    const edited = f.source + "REMARK actual draft\n";
    await act(async () => f.controller.updateDraft(f.doc, edited, { previewApplied: true }));
    await f.drag();
    expect(writes.map((write) => write.command)).toEqual(["write_text_file"]);
    expect(new TextDecoder().decode(writes[0].bytes)).toBe(edited);
  } finally {
    await f.close();
  }
});
test("a scene that cannot carry its scientific state refuses drag instead of silently omitting it", async () => {
  const f = await fixture();
  try {
    const raw = await f.viewer.plugin.builders.data.rawData({
      data: "1\nsecond source\nC 4 4 4\n",
    });
    const trajectory = await f.viewer.plugin.builders.structure.parseTrajectory(raw, "xyz");
    await f.viewer.plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", {
      representationPreset: "empty",
    });
    await act(async () =>
      useMoleculeStore.setState({
        documents: [{ ...f.doc, sceneSourcePaths: [f.doc.path, "/Structures/second.xyz"] }],
      }),
    );
    await expect(f.drag()).rejects.toThrow(/belongs to one structure/u);
    expect(writes).toHaveLength(0);
  } finally {
    await f.close();
  }
});
