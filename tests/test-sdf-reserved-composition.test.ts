import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseStructureComposition } from "../apps/desktop/src/lib/structure-composition";
const molecule = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8").replace("$$$$\n", "");
const metadata = '{"version":1,"atoms":[],"conformer":{"label":"Kept in source"}}';
const record = (properties: [string, string][]) => `${molecule}${properties.map(([name, value]) => `> <${name}>\n${value}\n\n`).join("")}$$$$\n`;

test("Info omits the exact reserved metadata key without changing molecular composition or source bytes", () => {
  const text = record([["BURETTE_METADATA_V1", metadata]]);
  const originalBytes = new TextEncoder().encode(text);
  expect(parseStructureComposition(text, "sdf")).toEqual(parseStructureComposition(record([]), "sdf"));
  expect(new TextEncoder().encode(text)).toEqual(originalBytes);
  expect(text).toContain(`> <BURETTE_METADATA_V1>\n${metadata}\n\n`);
});

test("ordinary SDF properties including BURETTE prefixes, suffixes and case variants remain visible", () => {
  const userProperties: [string, string][] = [
    ["ID", "EtOH-1"], ["BURETTE_METADATA_V1_EXTRA", "user suffix"],
    ["BURETTE_USER_NOTE", "user prefix"], ["burette_metadata_v1", "user lowercase"],
  ];
  const text = record([[" BURETTE_METADATA_V1 ", metadata], ...userProperties]);
  const summary = parseStructureComposition(text, "sdf")!;
  expect(summary).toEqual(parseStructureComposition(record(userProperties), "sdf")!);
  expect(summary.rows.find(row => row.label === "Properties")).toEqual({ label: "Properties", value: "4" });
  expect(summary.componentRows.find(row => row.label === "Properties")).toEqual({ label: "Properties", value: userProperties.map(([name]) => name).join(", ") });
  expect(text).toContain(metadata);
});

test("reserved metadata in collection records does not erase ordinary properties or change molecule navigation", () => {
  const baseline = record([["ASSAY", "first"]]) + record([["BURETTE_SOURCE", "second"]]);
  const withMetadata = record([["BURETTE_METADATA_V1", metadata], ["ASSAY", "first"]]) + record([["BURETTE_SOURCE", "second"], ["BURETTE_METADATA_V1", metadata]]);
  expect(parseStructureComposition(withMetadata, "sdf")).toEqual(parseStructureComposition(baseline, "sdf"));
  expect(withMetadata.match(/> <BURETTE_METADATA_V1>/gu)?.length).toBe(2);
});
