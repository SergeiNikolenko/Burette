import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import React, { act, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { OrbitalLevelDiagram } from "../apps/desktop/src/components/workbench/orbital-level-diagram";

const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent, requestAnimationFrame: browser.requestAnimationFrame.bind(browser), cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const science = parseScientificFile("ch2.cjson", readFileSync(new URL("fixtures/cjson/avogadro-ch2-triplet-uhf.cjson", import.meta.url), "utf8"));
// Frontier orbitals as printed in the CJSON: four occupied levels in each spin channel.
const frontier = new Map<number, "HOMO" | "LUMO">([[3, "HOMO"], [4, "LUMO"], [10, "HOMO"], [11, "LUMO"]]);

function Diagram({ onChange, shift = 0 }: { onChange: (index: number) => void; shift?: number }) {
  const [selected, setSelected] = useState<number>(3);
  const orbitals = useMemo(() => science.orbitals.map((orbital) => ({ ...orbital, energyHartree: orbital.energyHartree + shift })), [shift]);
  return <OrbitalLevelDiagram orbitals={orbitals} frontier={frontier} selected={selected} selectable onSelect={(index) => { setSelected(index); onChange(index); }} />;
}

test("an unrestricted CJSON draws alpha and beta levels with their energies, gap and spin partners, and selects levels by click and keys", async () => {
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
  expect(options.map((item) => item.hasAttribute("data-occupied"))).toEqual([true, true, true, false, false, false, true, true, true, false, false, false]);
  // Every level carries its energy; the frontier ones also their name.
  const label = (name: string) => option(name).querySelector(".orbital-level-label")!;
  expect([label("Orbital 4 α").textContent, label("Orbital 5 β").textContent, label("Orbital 2 α").textContent]).toEqual(["HOMO\u221211.12", "10.38LUMO", "\u221224.08"]);
  // The gap of each spin is shaded, and the same orbital of both spins is joined.
  expect(host.querySelectorAll(".orbital-diagram-gap")).toHaveLength(2);
  expect(host.querySelectorAll(".orbital-diagram-partner")).toHaveLength(6);
  expect([...host.querySelectorAll(".orbital-level-tag")].map((tag) => tag.textContent)).toEqual(["HOMO", "LUMO", "HOMO", "LUMO"]);
  expect([...host.querySelectorAll(".orbital-diagram-unit")].map((text) => text.textContent)).toEqual(["eV", "α", "β"]);
  // Higher energy is higher on screen, and the 1.28 eV alpha gap stays visible.
  const y = (name: string) => Number(option(name).querySelector(".orbital-level-bar")!.getAttribute("y1"));
  expect(y("Orbital 4 α") - y("Orbital 5 α")).toBeGreaterThan(4);
  // The labels of that narrow gap do not overlap.
  const labelY = (name: string) => Number(label(name).getAttribute("y"));
  expect(labelY("Orbital 4 α") - labelY("Orbital 5 α")).toBeGreaterThanOrEqual(12);
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

test("spin partners pair by place in the channel when the reader numbers orbitals across both channels", async () => {
  // ORCA numbers the beta orbitals after the alpha ones.
  const orca = parseScientificFile("dvb.out", readFileSync(new URL("fixtures/quantum/orca-log/cclib-orca6-dvb_sp_un_dft.out", import.meta.url), "utf8"));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<OrbitalLevelDiagram orbitals={orca.orbitals} frontier={new Map()} selected={null} selectable={false} onSelect={() => {}} />));
  // 35 alpha and 34 beta electrons: the two 16-level windows around each gap share 15 places.
  expect(host.querySelectorAll(".orbital-diagram-partner").length).toBe(15);
  await act(async () => root.unmount()); host.remove();
});

test("levels glide to the energies of another frame and end exactly where a fresh diagram puts them", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const bar = (where: Element) => Number(where.querySelector('[aria-label^="Orbital 4 α,"] .orbital-level-bar')!.getAttribute("y1"));
  await act(async () => root.render(<Diagram onChange={() => {}} />));
  const before = bar(host);
  await act(async () => root.render(<Diagram onChange={() => {}} shift={0.01} />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  const fresh = document.createElement("div"), other = createRoot(fresh);
  await act(async () => other.render(<Diagram onChange={() => {}} shift={0.01} />));
  // Shifting every level by one amount moves the range with them, so the bar keeps its place.
  expect(bar(host)).toBeCloseTo(bar(fresh), 6);
  expect(bar(host)).toBeCloseTo(before, 6);
  expect(host.querySelector('[aria-label^="Orbital 4 α,"] .orbital-level-label')!.textContent).toBe("HOMO\u221210.85");
  await act(async () => { root.unmount(); other.unmount(); }); host.remove();
});
