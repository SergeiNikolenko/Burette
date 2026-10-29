import { expect, test } from "bun:test";
import { act } from "react";
import {
  fixture,
  assertArchive,
  writes,
  relays,
  until,
  tick,
  sendNativeMessage,
  setParentAlive,
} from "./native-scientific-consumer-fixture";
import { useMoleculeStore } from "../apps/desktop/src/stores/molecule-store";
import {
  popOutNativeScene,
  returnNativePopout,
  nativePopoutBusy,
} from "../apps/desktop/src/components/workspace-panes/native-scene-window";
test("native checkpoint retains science and keeps origin until receiving window acknowledges", async () => {
  const f = await fixture();
  try {
    const moving = popOutNativeScene(f.tab().id);
    await until(() => relays.some((row) => row.message.kind === "offer"));
    expect(useMoleculeStore.getState().tabs.some((tab) => tab.location.kind === "file")).toBe(true);
    expect(f.surface.inert).toBe(true);
    await assertArchive(writes[0].bytes, f);
    const offer = relays.find((row) => row.message.kind === "offer");
    await act(async () =>
      sendNativeMessage({ kind: "ready", id: offer.message.id, from: "workspace-peer" }),
    );
    await moving;
    expect(useMoleculeStore.getState().tabs.some((tab) => tab.location.kind === "file")).toBe(
      false,
    );
    expect(nativePopoutBusy()).toBe(false);
  } finally {
    await f.close();
  }
});
test("receiver withholds native ready until scientific restore/ACK, and return checkpoint retains data", async () => {
  const f = await fixture("xyz", true);
  try {
    const receiving = sendNativeMessage({
      kind: "offer",
      id: crypto.randomUUID(),
      from: "workspace-parent",
      path: f.doc.path,
      title: "Returned scene",
      pinned: false,
      index: 0,
    });
    await tick();
    expect(relays).toHaveLength(0);
    expect(f.reserved()).toBeGreaterThan(0);
    await f.ready();
    await receiving;
    expect(relays.some((row) => row.message.kind === "ready")).toBe(true);
    expect(f.reserved()).toBe(0);
    setParentAlive(false);
    await act(async () => {
      expect(await returnNativePopout()).toBe(false);
    });
    expect(writes[0].command).toBe("save_popout_scene");
    await assertArchive(writes[0].bytes, f);
  } finally {
    await f.close();
  }
});
test("native checkpoint refuses a source replaced before snapshot response instead of writing or closing it", async () => {
  const f = await fixture();
  try {
    f.holdSnapshot();
    const moving = popOutNativeScene(f.tab().id);
    await until(f.snapshotEntered);
    await f.replace();
    f.releaseSnapshot();
    await moving;
    expect(writes).toHaveLength(0);
    expect(useMoleculeStore.getState().tabs.some((tab) => tab.location.kind === "file")).toBe(true);
    expect(nativePopoutBusy()).toBe(false);
  } finally {
    await f.close();
  }
});

test("peer ready cannot close a replacement that took the source tab after checkpoint was written", async () => {
  const f = await fixture();
  try {
    const moving = popOutNativeScene(f.tab().id);
    await until(() => relays.some((row) => row.message.kind === "offer"));
    const offer = relays.find((row) => row.message.kind === "offer");
    await assertArchive(writes[0].bytes, f);
    await f.replace();
    await act(async () =>
      sendNativeMessage({ kind: "ready", id: offer.message.id, from: "workspace-peer" }),
    );
    await moving;
    expect(
      useMoleculeStore
        .getState()
        .tabs.some(
          (tab) =>
            tab.location.kind === "file" && tab.location.documentId === f.doc.id + "-replacement",
        ),
    ).toBe(true);
    expect(writes).toHaveLength(1);
    expect(nativePopoutBusy()).toBe(false);
  } finally {
    await f.close();
  }
});
