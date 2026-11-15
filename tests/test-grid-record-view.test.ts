import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { functionSource, sdfRows, type GridRow } from "./fixtures/table-shaping/grid-functions";

// The record view is the grid's molecule detail overlay with previous and next:
// one row at a time, all its fields, stepping through the rows the grid shows.
// The viewer's own functions run here against a real DOM.
const LIFTED = [
  "showMoleculeDetail", "stepMoleculeDetail", "hideMoleculeDetail", "installMoleculeDetailTabs",
  "installMoleculeDetailDescriptorSearch", "moleculeDetailPropertyHTML", "moleculeDetailDescriptors", "descriptorEntries",
  "moleculeDetailSource", "moleculeDetailJson", "descriptorJsonValue", "formatMoleculeDetailNumber",
  "isEditableShortcutTarget", "escapeHTML",
];

function recordView(rows: GridRow[], options: { remote?: GridRow[] } = {}) {
  const browser = new Window();
  const document = browser.document;
  document.body.innerHTML = '<button id="opener">Open</button><div id="app"><div id="grid"></div></div>';
  const state = {
    rows: rows.slice(), remoteMode: Boolean(options.remote), totalRows: (options.remote ?? rows).length,
    dataToken: 0, columnValueRanges: new Map(), loads: [] as number[],
  };
  const api = new Function("state", "document", "root", "HTMLElement", "source", `
    function draw(row) { return '<svg data-row="' + row.index + '"></svg>'; }
    function tableColumnCatalog() { return []; }
    function filterColumnStats() { return null; }
    function formatValueRangeBound(value, fallback) { return value == null ? fallback : String(value); }
    function descriptorDisplayValue(value) { return String(value?.value ?? ''); }
    function descriptorHelpText() { return ''; }
    function escapeAttr(value) { return escapeHTML(value); }
    function scheduleRdkitCard() {}
    function scheduleXyzrenderCard() {}
    // The next page of a paged collection arrives when a step asks for a row past the loaded ones.
    async function loadRemoteRowsThrough(position) {
      state.loads.push(position);
      await Promise.resolve();
      state.rows.push(...source.slice(state.rows.length, position + 1));
    }
    ${LIFTED.map(functionSource).join("\n")}
    return { showMoleculeDetail, hideMoleculeDetail };
  `)(state, document, document.getElementById("app"), browser.HTMLElement, options.remote ?? rows) as {
    showMoleculeDetail: (row: GridRow, cfg: unknown) => void;
    hideMoleculeDetail: () => void;
  };
  const overlay = () => document.querySelector(".buret-grid-molecule-detail-overlay");
  const text = (selector: string) => overlay()?.querySelector(selector)?.textContent ?? null;
  const step = (delta: 1 | -1) => overlay()!.querySelector(`[data-buret-detail-step="${delta}"]`) as unknown as HTMLButtonElement;
  const key = (name: string, target: { dispatchEvent: (event: never) => boolean } = document as never) =>
    target.dispatchEvent(new browser.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }) as never);
  const fields = () => {
    const list = overlay()!.querySelector(".buret-grid-molecule-detail-props")!;
    const names = [...list.querySelectorAll("dt")].map((node) => node.textContent);
    const values = [...list.querySelectorAll(".buret-grid-molecule-detail-prop-value")].map((node) => node.textContent);
    return Object.fromEntries(names.map((name, index) => [name, values[index]]));
  };
  return { state, api, document, overlay, text, step, key, fields };
}

const compounds = () => sdfRows("chembl-compounds.sdf");
const TITLE = "#buret-grid-molecule-detail-title";
const POSITION = ".buret-grid-molecule-detail-position";

test("the record view shows one row with all its fields and steps through the rows with buttons and arrow keys", () => {
  const { api, document, overlay, text, step, key, fields } = recordView(compounds());
  (document.getElementById("opener") as unknown as HTMLElement).focus();
  api.showMoleculeDetail(compounds()[0], {});
  expect([text(TITLE), text(POSITION)]).toEqual(["Aspirin", "1 of 11"]);
  // Numbers are shown the way the detail view rounds them; the full text is the cell's tooltip.
  expect(fields()).toEqual({ "ChEMBL ID": "CHEMBL25", Class: "NSAID", MW: "180.2", Source: "handbook" });
  expect(overlay()!.querySelector('.buret-grid-molecule-detail-prop-value[title="180.16"]')).not.toBeNull();
  expect(overlay()!.querySelector("[data-buret-molecule-picture] svg")!.getAttribute("data-row")).toBe("0");
  expect(step(-1).disabled).toBe(true);

  step(1).click();
  expect([text(TITLE), text(POSITION)]).toEqual(["Ibuprofen", "2 of 11"]);
  expect(fields()["ChEMBL ID"]).toBe("CHEMBL521");
  // Focus stays on the button that was pressed, so it can be pressed again.
  expect(document.activeElement).toBe(step(1) as never);
  expect(document.querySelectorAll(".buret-grid-molecule-detail-overlay").length).toBe(1);

  key("ArrowRight");
  expect(text(TITLE)).toBe("Naproxen");
  key("ArrowLeft");
  key("ArrowLeft");
  expect([text(TITLE), text(POSITION)]).toEqual(["Aspirin", "1 of 11"]);
  key("ArrowLeft");
  expect(text(TITLE)).toBe("Aspirin");

  // The open tab is kept from record to record.
  (overlay()!.querySelector('[data-buret-detail-tab="source"]') as unknown as HTMLElement).click();
  step(1).click();
  expect(overlay()!.querySelector('[data-buret-detail-tab="source"]')!.getAttribute("aria-selected")).toBe("true");
  expect(text(".buret-grid-molecule-detail-source")).toBe("molblock 1");

  for (let count = 0; count < 20; count += 1) key("ArrowRight");
  expect([text(TITLE), text(POSITION)]).toEqual(["Acetylsalicylic acid", "11 of 11"]);
  expect(step(1).disabled).toBe(true);
  // A row without a class simply has no such field.
  key("ArrowLeft"); key("ArrowLeft");
  expect([text(TITLE), Object.keys(fields())]).toEqual(["Diazepam", ["ChEMBL ID", "MW", "Source"]]);

  // Escape closes the view and gives focus back to where it was opened from.
  key("Escape");
  expect(overlay()).toBeNull();
  expect(document.activeElement).toBe(document.getElementById("opener") as never);
});

test("the record view steps through the filtered rows only, and leaves the arrow keys to a text field", () => {
  const stimulants = compounds().filter((row) => row.props.Class === "Stimulant");
  const { api, overlay, text, step, key } = recordView(stimulants);
  api.showMoleculeDetail(stimulants[1], {});
  expect([text(TITLE), text(POSITION)]).toEqual(["Theophylline", "2 of 3"]);
  step(1).click();
  expect([text(TITLE), text(POSITION), step(1).disabled]).toEqual(["Nicotine", "3 of 3", true]);

  const field = overlay()!.ownerDocument.createElement("input");
  overlay()!.querySelector(".buret-grid-molecule-detail-body")!.append(field);
  key("ArrowLeft", field as never);
  expect(text(TITLE)).toBe("Nicotine");

  // A single row has nothing to step to, so the controls are not drawn.
  const single = recordView(stimulants.slice(0, 1));
  single.api.showMoleculeDetail(stimulants[0], {});
  expect(single.overlay()!.querySelector(".buret-grid-molecule-detail-nav")).toBeNull();
});

test("a paged collection loads the next page when the record view steps past the loaded rows", async () => {
  const all = compounds();
  const { state, api, text, step } = recordView(all.slice(0, 4), { remote: all });
  api.showMoleculeDetail(all[3], {});
  expect([text(TITLE), text(POSITION), step(1).disabled]).toEqual(["Diclofenac", "4 of 11", false]);
  step(1).click();
  // A second press while the page is on its way does not skip a record.
  step(1).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.loads).toEqual([4]);
  expect([text(TITLE), text(POSITION)]).toEqual(["Paracetamol", "5 of 11"]);
});
