import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import React, { act, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { OrbitalLevelDiagram } from "../apps/desktop/src/components/workbench/orbital-level-diagram";

const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const science = parseScientificFile("ch2.cjson", readFileSync(new URL("fixtures/cjson/avogadro-ch2-triplet-uhf.cjson", import.meta.url), "utf8"));
// Frontier orbitals as printed in the CJSON: four occupied levels in each spin channel.
const frontier = new Map<number, "HOMO" | "LUMO">([[3, "HOMO"], [4, "LUMO"], [10, "HOMO"], [11, "LUMO"]]);

function Diagram({ onChange }: { onChange: (index: number) => void }) {
  const [selected, setSelected] = useState<number>(3);
  const orbitals = useMemo(() => science.orbitals, []);
  return <OrbitalLevelDiagram orbitals={orbitals} frontier={frontier} selected={selected} selectable onSelect={(index) => { setSelected(index); onChange(index); }} />;
}

test("an unrestricted CJSON draws alpha and beta levels with their occupancy and frontier labels, and selects levels by click and keys", async () => {
  expect(science.orbitals.map((orbital) => orbital.spin)).toEqual([...Array(7).fill("alpha"), ...Array(7).fill("beta")]);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), chosen: number[] = [];
  await act(async () => root.render(<Diagram onChange={(index) => chosen.push(index)} />));
  const options = [...host.querySelectorAll('[role="option"]')];
  const option = (label: string) => options.find((item) => item.getAttribute("aria-label")!.startsWith(`${label},`))!;
  // The 1s core levels near −299 eV stay in the table; the diagram shows the valence region.
  expect(options.map((item) => item.getAttribute("aria-label")!.split(",")[0])).toEqual([
    ...[2, 3, 4, 5, 6, 7].map((n) => `Orbital ${n} α`), ...[2, 3, 4, 5, 6, 7].map((n) => `Orbital ${n} β`)]);
  expect(option("Orbital 4 α").getAttribute("aria-label")).toBe("Orbital 4 α, HOMO, -11.122 eV, occupancy 1");
  expect(option("Orbital 4 β").getAttribute("aria-label")).toBe("Orbital 4 β, HOMO, 8.494 eV, occupancy 1");
  // One arrow per singly occupied spin orbital.
  expect(options.map((item) => item.querySelectorAll(".orbital-level-arrow").length)).toEqual([1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0]);
  expect([...host.querySelectorAll(".orbital-level-tag")].map((tag) => tag.textContent)).toEqual(["HOMO", "LUMO", "HOMO", "LUMO"]);
  expect([...host.querySelectorAll(".orbital-diagram-unit")].map((text) => text.textContent)).toEqual(["eV", "α", "β"]);
  // Higher energy is higher on screen, and the 1.28 eV alpha gap stays visible.
  const y = (label: string) => Number(option(label).querySelector("line")!.getAttribute("y1"));
  expect(y("Orbital 4 α") - y("Orbital 5 α")).toBeGreaterThan(4);
  // The labels of that narrow gap do not overlap.
  const tagY = (label: string) => Number(option(label).querySelector(".orbital-level-tag")!.getAttribute("y"));
  expect(tagY("Orbital 4 α") - tagY("Orbital 5 α")).toBeGreaterThanOrEqual(11);
  const svg = host.querySelector("svg")!;
  const key = (name: string) => act(async () => { svg.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
  await key("ArrowUp");
  await key("ArrowRight");
  await key("End");
  await act(async () => { option("Orbital 2 β").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  // Up from the alpha HOMO is its LUMO; Right lands on the beta level nearest to it in energy
  // (orbital 3 β at −0.496 Eh for −0.362 Eh), and End is the highest beta level.
  expect(chosen).toEqual([4, 9, 13, 8]);
  expect(svg.getAttribute("aria-activedescendant")).toBe(option("Orbital 2 β").id);
  await act(async () => root.unmount()); host.remove();
});
