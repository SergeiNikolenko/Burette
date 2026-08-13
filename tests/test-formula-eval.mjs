// The expression language behind computed columns. A formula is user input
// evaluated over every row, so the grammar's edges - precedence, missing
// inputs, and anything that looks like an escape into JavaScript - are pinned
// here.
import assert from "node:assert/strict";

import { compileFormula, FormulaError, FORMULA_FUNCTION_NAMES } from "../apps/desktop/src/lib/formula-eval.mjs";

const evaluate = (source, row = {}) => compileFormula(source).evaluate((name) => row[name]);
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

// --- arithmetic and precedence ---
assert.equal(evaluate("1 + 2 * 3"), 7);
assert.equal(evaluate("(1 + 2) * 3"), 9);
assert.equal(evaluate("10 - 2 - 3"), 5, "subtraction is left associative");
assert.equal(evaluate("2 ^ 3 ^ 2"), 512, "exponentiation is right associative");
assert.equal(evaluate("-2 ^ 2"), -4, "unary minus binds looser than the power");
assert.equal(evaluate("8 / 4 / 2"), 1);
near(evaluate("1.5e2 + 0.5"), 150.5);

// --- division by zero has no answer, rather than Infinity ---
assert.equal(evaluate("1 / 0"), null);
assert.equal(evaluate("[MW] / [Zero]", { MW: 10, Zero: 0 }), null);

// --- variables, bare and bracketed ---
assert.equal(evaluate("MW * 2", { MW: 21 }), 42);
assert.equal(evaluate("[Molecular Weight] + 1", { "Molecular Weight": 41 }), 42);
assert.equal(evaluate("[pIC50] - [AlogP]", { pIC50: 9, AlogP: 3 }), 6);
assert.deepEqual(compileFormula("[a] + [b] + [a]").variables, ["a", "b"], "variables are reported once");

// --- a row missing an input has no answer, and never a zero ---
assert.equal(evaluate("MW * 2", {}), null);
assert.equal(evaluate("MW * 2", { MW: "not a number" }), null);
assert.equal(evaluate("MW * 2", { MW: Number.NaN }), null);
assert.equal(evaluate("MW + 0", { MW: null }), null);

// --- functions ---
near(evaluate("log(1000)"), 3);
near(evaluate("log10(100)"), 2);
near(evaluate("ln(exp(1))"), 1);
near(evaluate("sqrt(16)"), 4);
assert.equal(evaluate("abs(0 - 7)"), 7);
assert.equal(evaluate("min(3, 9)"), 3);
assert.equal(evaluate("max(3, 9)"), 9);
assert.equal(evaluate("round(2.6)"), 3);
assert.equal(evaluate("floor(2.6)"), 2);
assert.equal(evaluate("ceil(2.1)"), 3);
assert.equal(evaluate("pow(2, 10)"), 1024);
assert.equal(evaluate("LOG(1000)"), 3, "function names are case-insensitive");

// Out-of-domain gives no answer instead of NaN leaking into a column.
assert.equal(evaluate("log(0)"), null);
assert.equal(evaluate("ln(0 - 1)"), null);
assert.equal(evaluate("sqrt(0 - 4)"), null);

// --- comparisons and if() ---
assert.equal(evaluate("if(MW > 500, 1, 0)", { MW: 600 }), 1);
assert.equal(evaluate("if(MW > 500, 1, 0)", { MW: 400 }), 0);
assert.equal(evaluate("if([pIC50] >= 8, [pIC50], 0)", { pIC50: 9.2 }), 9.2);
assert.equal(evaluate("3 < 4"), 1, "a bare comparison is 1 or 0");
assert.equal(evaluate("3 == 4"), 0);
assert.equal(evaluate("3 != 4"), 1);
assert.equal(evaluate("if(MW > 1, 1, 0)", {}), null, "a missing input still has no answer");

// --- the real formulas this exists for ---
// Ligand efficiency: 1.37 * pIC50 / heavy atoms.
near(evaluate("1.37 * [pIC50] / [HeavyAtoms]", { pIC50: 9, HeavyAtoms: 30 }), 0.411);
// Lipophilic ligand efficiency: pIC50 - cLogP.
near(evaluate("[pIC50] - [cLogP]", { pIC50: 8.5, cLogP: 3.2 }), 5.3);
// pIC50 from a nanomolar IC50.
near(evaluate("0 - log([IC50] / 1000000000)", { IC50: 10 }), 8);

// --- bad formulas are rejected at compile time, with a reason ---
for (const bad of ["", "   ", "1 +", "(1 + 2", "1 + )", "min(1)", "max(1, 2, 3)", "1 $ 2", "[unclosed"]) {
  assert.throws(() => compileFormula(bad), FormulaError, `rejects ${JSON.stringify(bad)}`);
}

// --- nothing escapes into JavaScript ---
// These are all just unknown variables or syntax errors; none may execute.
globalThis.__formulaCanary = 0;
for (const attempt of [
  "constructor",
  "globalThis",
  "process.exit(1)",
  "__formulaCanary + 1",
]) {
  let result = null;
  try {
    result = evaluate(attempt, {});
  } catch (error) {
    assert.ok(error instanceof FormulaError, `${attempt} fails as a formula error`);
  }
  assert.ok(result === null || typeof result === "number", `${attempt} yields no object`);
}
assert.equal(globalThis.__formulaCanary, 0, "no formula ran host code");
// An identifier that happens to name a global is only ever a column lookup.
assert.equal(evaluate("globalThis", { globalThis: 5 }), 5);
delete globalThis.__formulaCanary;

// --- the function catalogue is exported for the dialog's help text ---
assert.ok(FORMULA_FUNCTION_NAMES.includes("log") && FORMULA_FUNCTION_NAMES.includes("if"));

console.log("formula-eval tests passed");
