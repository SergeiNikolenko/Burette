import assert from "node:assert/strict";
import React, { act } from "react";
import { test } from "bun:test";
import { Fixture, source, writes, until, click, button, createHost, replaceSource } from "./structure-edit-fixture";

// The ethanol SDF fixture's own V2000 atom rows are the reference positions.
const sourceAtoms = source.split("\n").slice(4, 7).map(line => {
  const [x, y, z, element] = line.trim().split(/\s+/u);
  return { element, position: [x, y, z].map(Number) };
});
const area = (host: Element) => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Coordinates"]')!;
const type = (host: Element, value: string) => act(async () => {
  const element = area(host);
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
});
const atomRows = (text: string) => text.split("\n").filter(line => /^M {2}V30 \d+ [A-Z]/u.test(line) && !/BEGIN|END/u.test(line));
const v3000Positions = (text: string) => atomRows(text).map(line => line.split(/\s+/u).slice(4, 7).map(Number));
const bondRows = (text: string) => text.split("\n").filter(line => /^M {2}V30 \d+ \d+ \d+ \d+$/u.test(line));

test("Cartesian coordinates of an SDF graph: invalid line, Revert, Apply as one Undo step, refused atom changes", async () => {
  const { host, root } = createHost();
  try {
    await act(async () => root.render(<Fixture />));
    await until(host, () => host.querySelectorAll("[data-atom]").length === 3, "the atom table");
    await click(button(host, "Cartesian"));
    await until(host, () => area(host), "the coordinate editor");
    const generated = area(host).value;
    // XYZ (symbols) by default: six decimals of the source rows.
    assert.deepEqual(generated.trim().split("\n").map(line => line.trim().split(/\s+/u)),
      sourceAtoms.map(({ element, position }) => [element, ...position.map(value => value.toFixed(6))]));
    assert.equal(button(host, "Apply").disabled, true, "nothing to apply before an edit");

    const lines = generated.split("\n");
    await type(host, [lines[0], lines[1].replace(/0\.587100/u, "0.58x"), lines[2], ""].join("\n"));
    await until(host, () => host.querySelector('[aria-label="Invalid lines"]')?.textContent?.includes("Line 2 Invalid coordinate."), "the invalid line");
    assert.equal(area(host).getAttribute("aria-invalid"), "true");
    assert.equal(button(host, "Apply").disabled, true);
    await click(button(host, "Revert"));
    assert.equal(area(host).value, generated);
    assert.equal(host.querySelector('[aria-label="Invalid lines"]'), null);

    // Turbomole presets switch to bohr; the same atoms read back unchanged.
    const preset = host.querySelector<HTMLSelectElement>("select[aria-label=\"Preset\"]")!;
    await act(async () => { preset.value = "turbomole"; preset.dispatchEvent(new window.Event("change", { bubbles: true })); });
    await until(host, () => /\bO\s*$/mu.test(area(host).value), "the Turbomole block");
    const bohr = area(host).value.trim().split("\n").map(line => line.trim().split(/\s+/u).slice(0, 3).map(Number));
    bohr.forEach((row, atom) => row.forEach((value, axis) => assert.ok(Math.abs(value * 0.529177210544 - sourceAtoms[atom].position[axis]) < 1e-6)));
    await act(async () => { preset.value = "xyz-symbols"; preset.dispatchEvent(new window.Event("change", { bubbles: true })); });
    await until(host, () => area(host).value === generated, "the XYZ block");

    // A different count or element is refused without a draft.
    await type(host, `${generated}H 0 0 0\n`);
    await click(button(host, "Apply"));
    await until(host, () => host.textContent?.includes("this structure has 3. Only positions can change here."), "the count refusal");
    await type(host, generated.replace(/^O /mu, "N "));
    await click(button(host, "Apply"));
    await until(host, () => host.textContent?.includes("Atom 3 is O, not N."), "the element refusal");
    assert.equal(writes.length, 0);

    await type(host, generated.replace(/-0\.017800/u, "-0.5"));
    await click(button(host, "Apply"));
    await until(host, () => writes.length === 1, "the applied positions");
    const draft = writes[0].content;
    assert.deepEqual(writes[0].options, { view: "keep" });
    const expected = sourceAtoms.map(({ position }, atom) => atom === 2 ? [position[0], position[1], -0.5] : position);
    assert.deepEqual(v3000Positions(draft), expected);
    // Title, data item and both bonds are the source's own.
    assert.equal(draft.split("\n")[0], "ethanol");
    assert.match(draft, /> <ID>\nEtOH-1\n\n/u);
    assert.deepEqual(bondRows(draft).map(line => line.split(/\s+/u).slice(3).join(" ")), ["1 1 2", "1 2 3"]);
    await until(host, () => area(host).value.includes("-0.500000") && button(host, "Apply").disabled, "the regenerated block");

    await click(button(host, "Undo"));
    await until(host, () => writes.length === 2, "undo");
    assert.equal(writes[1].content, source);
    await until(host, () => area(host).value === generated, "the restored block");
    await click(button(host, "Redo"));
    await until(host, () => writes.length === 3, "redo");
    assert.equal(writes[2].content, draft);

    // A draft of a structure that changed elsewhere is never applied; Revert shows the new one.
    await type(host, area(host).value.replace(/-0\.500000/u, "-0.25"));
    await act(async () => replaceSource(source.replace("-0.0178 O", " 0.1000 O")));
    await until(host, () => host.textContent?.includes("The structure changed. Revert to edit its current coordinates."), "the stale draft");
    assert.equal(button(host, "Apply").disabled, true);
    await click(button(host, "Revert"));
    await until(host, () => area(host).value.split("\n")[2].endsWith("0.100000"), "the replaced source");
    assert.equal(writes.length, 3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 30_000);
