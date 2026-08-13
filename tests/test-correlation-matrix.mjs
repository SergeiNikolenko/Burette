// Pearson correlations for the Analyze menu's matrix. Pairwise-complete
// observation handling is the part that silently goes wrong, so the overlap
// rules are pinned here alongside the textbook values.
import assert from "node:assert/strict";

import { correlationMatrix, pearson } from "../apps/desktop/src/lib/correlation-matrix.mjs";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

// --- pearson ---
near(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12);
near(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1, 1e-12);
// Worked by hand: means 3 and 4, cov 6, variances 10 and 6, so r = 6/sqrt(60).
near(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]), 6 / Math.sqrt(60), 1e-12);
assert.equal(pearson([1, 2], [3, 4]), null, "two points are not a correlation");
assert.equal(pearson([5, 5, 5, 5], [1, 2, 3, 4]), null, "a constant column has no direction");
assert.equal(pearson([1, 2, 3], [7, 7, 7]), null, "a constant partner has no direction");
assert.ok(Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8])) <= 1, "never escapes the unit range");

// --- matrix, fully populated ---
const rows = [0, 1, 2, 3, 4];
const mw = rows.map((id) => [id, 100 + id * 10]);
const doubled = rows.map((id) => [id, 200 + id * 20]);
const inverse = rows.map((id) => [id, 50 - id * 5]);
const result = correlationMatrix([
  { id: "MW", label: "MW", values: mw },
  { id: "MW2", label: "MW doubled", values: doubled },
  { id: "INV", label: "Inverse", values: inverse },
]);
assert.deepEqual(result.labels, ["MW", "MW doubled", "Inverse"]);
near(result.matrix[0][0], 1);
near(result.matrix[0][1], 1, 1e-12);
near(result.matrix[0][2], -1, 1e-12);
assert.equal(result.matrix[1][0], result.matrix[0][1], "matrix is symmetric");
assert.equal(result.counts[0][1], 5);

// --- pairwise-complete: a sparse column only loses its own pairs ---
const sparse = [[0, 1], [1, 2], [4, 9]];
const withSparse = correlationMatrix([
  { id: "MW", label: "MW", values: mw },
  { id: "SPARSE", label: "Sparse", values: sparse },
  { id: "INV", label: "Inverse", values: inverse },
]);
assert.equal(withSparse.counts[0][1], 3, "MW vs Sparse uses only shared rows");
assert.equal(withSparse.counts[0][2], 5, "the dense pair keeps every row");
near(withSparse.matrix[0][2], -1, 1e-12, "a sparse third column cannot disturb the dense pair");

// --- too little overlap yields no coefficient, not a fake one ---
const disjoint = correlationMatrix([
  { id: "A", label: "A", values: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { id: "B", label: "B", values: [[10, 1], [11, 2], [12, 3], [13, 4]] },
]);
assert.equal(disjoint.matrix[0][1], null, "no shared rows means no correlation");
assert.equal(disjoint.counts[0][1], 0);

// --- non-numeric and malformed entries are dropped, not coerced ---
const messy = correlationMatrix([
  { id: "A", label: "A", values: [[0, 1], [1, "x"], [2, 3], [3, 4], [4, 5]] },
  { id: "B", label: "B", values: [[0, 2], [1, 4], [2, 6], [3, 8], [4, 10]] },
]);
assert.equal(messy.counts[0][1], 4, "the unparseable cell drops out of the pair");
near(messy.matrix[0][1], 1, 1e-12);

// --- empty input is a well-formed empty matrix ---
const empty = correlationMatrix([]);
assert.deepEqual(empty.matrix, []);
assert.deepEqual(empty.labels, []);

console.log("correlation-matrix tests passed");
