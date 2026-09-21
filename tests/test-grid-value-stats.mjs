// Unit tests for the histogram statistics behind the hover card's value tiles.
// Binned quartiles are easy to get subtly wrong, and a wrong fence silently
// mislabels ordinary molecules as outliers, so the math is pinned here.
import assert from "node:assert/strict";

import { columnStats, describePropValue, ordinal } from "../apps/desktop/src/lib/grid-value-stats.mjs";

const BINS = 32;
const emptyBins = () => new Array(BINS).fill(0);

// --- ordinal suffixes ---
assert.equal(ordinal(1), "1st");
assert.equal(ordinal(2), "2nd");
assert.equal(ordinal(3), "3rd");
assert.equal(ordinal(4), "4th");
assert.equal(ordinal(11), "11th", "teens never take st/nd/rd");
assert.equal(ordinal(12), "12th");
assert.equal(ordinal(13), "13th");
assert.equal(ordinal(21), "21st");
assert.equal(ordinal(101), "101st");

// --- columns without a usable distribution ---
assert.equal(columnStats(null), null);
assert.equal(columnStats({ min: 0, max: 1 }), null, "no bins");
assert.equal(columnStats({ min: 5, max: 5, bins: emptyBins() }), null, "zero range");
const tinyBins = emptyBins();
tinyBins[0] = 2;
tinyBins[10] = 2;
tinyBins[20] = 1;
assert.equal(columnStats({ min: 0, max: 10, bins: tinyBins }), null, "too few rows to describe a spread");

// --- binary activity flag: mass only at the extremes ---
const flagBins = emptyBins();
flagBins[0] = 900;
flagBins[BINS - 1] = 613;
const flagColumn = { min: 0, max: 1, bins: flagBins };
const flagStats = columnStats(flagColumn);
assert.equal(flagStats?.categorical, true, "two filled buckets read as a flag, not a measurement");
assert.equal(flagStats?.total, 1513);
const activeOn = describePropValue("1", flagColumn);
const activeOff = describePropValue("0", flagColumn);
assert.equal(activeOn.tone, "flag-on");
assert.equal(activeOff.tone, "flag-off");
assert.equal(activeOn.position, null, "a flag has no meaningful place in a range");
assert.match(activeOn.detail ?? "", /1,513 rows/u);

// --- continuous column: percentile, fences, outliers ---
const bulkBins = emptyBins();
for (let index = 0; index <= 12; index += 1) bulkBins[index] = 10;
bulkBins[BINS - 1] = 1;
const column = { min: 0, max: 100, bins: bulkBins };
const stats = columnStats(column);
assert.equal(stats?.categorical, false);
assert.equal(stats?.total, 131);
assert.ok(stats.q1 < stats.q3, "quartiles ordered");
assert.ok(stats.q1 > 0 && stats.q3 < 40, `quartiles inside the bulk, got ${stats.q1}/${stats.q3}`);
assert.ok(stats.upperFence > stats.q3 && stats.upperFence < 100, "the lone far value sits beyond the fence");

const middle = describePropValue("20", column);
assert.equal(middle.tone, "plain");
assert.match(middle.detail ?? "", /percentile · 131 rows/u);
assert.ok(middle.position > 0.19 && middle.position < 0.21, `position tracks the range, got ${middle.position}`);

const far = describePropValue("100", column);
assert.equal(far.tone, "outlier-high");
assert.match(far.detail ?? "", /Unusually high/u);
assert.equal(far.position, 1);

// Percentile rises with the value and stays inside the range.
const low = describePropValue("1", column);
const high = describePropValue("39", column);
assert.ok(low.position < high.position, "position is monotonic");
assert.equal(describePropValue("-5", column).position, 0, "values below min clamp to the low end");

// A left-tail outlier is flagged too.
const tailBins = emptyBins();
tailBins[0] = 1;
for (let index = 19; index <= 31; index += 1) tailBins[index] = 10;
const tailColumn = { min: 0, max: 100, bins: tailBins };
assert.equal(describePropValue("0.5", tailColumn).tone, "outlier-low");
assert.match(describePropValue("0.5", tailColumn).detail ?? "", /Unusually low/u);

// --- values that carry no number stay plain ---
for (const value of ["smiles", "", null, undefined, "N/A"]) {
  assert.deepEqual(
    describePropValue(value, column),
    { tone: "plain", position: null, detail: null },
    `non-numeric ${JSON.stringify(value)} is never toned`,
  );
}
// A number with no column to compare against is plain as well.
assert.equal(describePropValue("42", undefined).tone, "plain");

// --- a tight column: ordinary inside the mass, flagged outside it ---
// Tukey fences scale with the spread, so in a column whose values all sit
// between 1.5 and 2.5 a zero really is an outlier - that is the rule working,
// not misfiring.
const tightBins = emptyBins();
tightBins[5] = 40;
tightBins[6] = 40;
tightBins[7] = 40;
const tightColumn = { min: 0, max: 10, bins: tightBins };
for (const value of ["1.7", "2", "2.4"]) {
  assert.equal(describePropValue(value, tightColumn).tone, "plain", `${value} sits inside the mass`);
}
assert.equal(describePropValue("0", tightColumn).tone, "outlier-low");
assert.equal(describePropValue("10", tightColumn).tone, "outlier-high");

console.log("grid-value-stats tests passed");
