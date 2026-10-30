import assert from "node:assert/strict";
import React, { act } from "react";
import { test } from "bun:test";
import { writes, source, until, click, button } from "./structure-edit-fixture";
import { propertiesFixture, opened, done } from "./pending/structure-edit-properties-fixture";

test("Properties changes an SDF in place as one Undo step continued in the Edit tab", async () => {
  const { Host, host, root } = await propertiesFixture();
  try {
    await act(async () => root.render(<Host panel={false} />));
    const add = () => button(document.body, "Add hydrogens");
    await until(document.body, () => add() && !add().disabled, "Properties ready");
    await click(add());
    await until(document.body, () => writes.length === 1, "the in-place draft");
    assert.match(writes[0].content, /^M {2}V30 COUNTS 9 8 /mu);
    assert.deepEqual(writes[0].options, { view: "keep" });
    assert.deepEqual(opened, ["structure-edit"]);
    assert.equal(done, 1);

    await act(async () => root.render(<Host panel />));
    await until(host, () => host.querySelectorAll("[data-atom]").length === 9, "the Edit tab on the same draft");
    assert.equal(button(host, "Undo").disabled, false);
    await click(button(host, "Undo"));
    await until(host, () => writes.length === 2, "undo of the Properties step");
    assert.equal(writes[1].content, source);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 30_000);
