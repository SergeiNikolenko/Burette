import { readFileSync } from "node:fs";
import { parseSdfDataTable } from "../../../apps/desktop/src/lib/table-shaping";

// The collection grid is one classic script, so its functions are tested the
// way tests/test-grid-table-operations.mjs does it: the exact source of each
// function is lifted out of the viewer and run over a plain state object.
const viewerSource = readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");

export function functionSource(name: string) {
  const start = [`\n  function ${name}(`, `\n  async function ${name}(`]
    .map((needle) => viewerSource.indexOf(needle))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  if (start === undefined) throw new Error(`missing ${name}`);
  const rest = viewerSource.slice(start + 1);
  return rest.slice(0, rest.search(/\n {2}(?:async )?function [A-Za-z_$]/u));
}

export const fixtureText = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

export type GridRow = { index: number; name: string; molblock: string; props: Record<string, string> };

/** The rows the grid holds for one of the SD fixtures; the structure is a stand-in. */
export function sdfRows(name: string): GridRow[] {
  const text = fixtureText(name);
  const names = text.split(/^\$\$\$\$\n/mu).filter((record) => record.trim()).map((record) => record.split("\n")[0]);
  return parseSdfDataTable(text).rows.map((props, index) => ({ index, name: names[index], molblock: `molblock ${index}`, props: { ...props } }));
}
