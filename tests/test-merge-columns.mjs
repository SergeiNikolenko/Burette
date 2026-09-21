import assert from "node:assert/strict";

import { joinColumnValues } from "../apps/desktop/src/lib/merge-columns.mjs";

// The ordinary case.
assert.equal(joinColumnValues(["BACE_231", "CHEMBL42"], " "), "BACE_231 CHEMBL42");
assert.equal(joinColumnValues(["a", "b"], " · "), "a · b");

// A row missing one side joins what it has, without a dangling separator on
// either end - which is what a naive `a + sep + b` would produce.
assert.equal(joinColumnValues(["BACE_231", ""], " "), "BACE_231");
assert.equal(joinColumnValues(["", "CHEMBL42"], " "), "CHEMBL42");

// A row with nothing to merge stays empty rather than becoming a bare
// separator: an empty cell reads as "no value", a lone space reads as a bug.
assert.equal(joinColumnValues(["", ""], " "), null);
assert.equal(joinColumnValues([null, undefined], " "), null);

// An empty separator is a legitimate choice - concatenation.
assert.equal(joinColumnValues(["AB", "CD"], ""), "ABCD");

// Whitespace a user typed on purpose is part of the value, not padding to trim.
assert.equal(joinColumnValues([" leading", "trailing "], "|"), " leading|trailing ");

// More than two columns fall out of the same rule.
assert.equal(joinColumnValues(["x", "", "z"], "-"), "x-z");

console.log("merge-columns tests passed");
