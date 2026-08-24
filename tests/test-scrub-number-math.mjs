#!/usr/bin/env bun
import assert from "node:assert/strict";

import {
  applyStepDelta,
  clampNumber,
  consumeWheelDelta,
  getScrubPointerDelta,
  hasExceededScrubThreshold,
  normalizeNumberFieldBounds,
  preserveDisplayDraft,
  quantizeNumber,
  resolveActiveStep,
  resolveDisplayDecimalPlaces,
  resolveFineStep,
  sanitizeNumericDraft,
} from "../apps/desktop/src/lib/scrub-number-math.ts";

assert.equal(clampNumber(-9, -8, 8), -8);
assert.equal(clampNumber(9, -8, 8), 8);
assert.deepEqual(normalizeNumberFieldBounds(100, 0), { min: 0, max: 100 });

for (const [value, step, expected] of [
  [0.12346, 0.0001, 0.1235],
  [0.1236, 0.001, 0.124],
  [0.0126, 0.005, 0.015],
  [0.956, 0.01, 0.96],
  [1.274, 0.05, 1.25],
  [-1.274, 0.05, -1.25],
]) {
  assert.equal(quantizeNumber(value, step), expected, `quantize ${value} by ${step}`);
}

assert.equal(resolveFineStep(0.005), 0.0005);
assert.equal(resolveActiveStep({ step: 1, shiftStep: 10, fineStep: 0.1 }), 1);
assert.equal(resolveActiveStep({ step: 1, shiftStep: 10, fineStep: 0.1, fine: true }), 0.1);
assert.equal(resolveActiveStep({ step: 1, shiftStep: 10, fineStep: 0.1, coarse: true }), 10);

assert.equal(applyStepDelta(0.5, 0.001, { step: 0.001, fineStep: 0.0001 }), 0.501);
assert.equal(applyStepDelta(0.95, 0.01, { step: 0.01, fineStep: 0.001 }), 0.96);
assert.equal(applyStepDelta(-2, 1, { step: 1, fineStep: 0.1 }), -1);

assert.deepEqual(consumeWheelDelta(0, 10, 20), { accumulated: 10, steps: 0, direction: 0 });
assert.deepEqual(consumeWheelDelta(10, 10, 20), { accumulated: 0, steps: 1, direction: -1 });
assert.deepEqual(consumeWheelDelta(0, -40, 20), { accumulated: 0, steps: 2, direction: 1 });

assert.equal(getScrubPointerDelta({ clientX: 24, clientY: 0 }, 10, 0, "horizontal"), 14);
assert.equal(getScrubPointerDelta({ clientX: 0, clientY: 5 }, 0, 20, "vertical"), 15);
assert.equal(hasExceededScrubThreshold({ clientX: 13, clientY: 0 }, 10, 0, "horizontal"), false);
assert.equal(hasExceededScrubThreshold({ clientX: 14, clientY: 0 }, 10, 0, "horizontal"), true);

assert.equal(sanitizeNumericDraft("-12.50"), "-12.50");
assert.equal(sanitizeNumericDraft("1e5", "12"), "12");
assert.equal(sanitizeNumericDraft("1.2.3", "1.2"), "1.2");
assert.equal(preserveDisplayDraft("12.50", 12.5, "12.5"), "12.50");
assert.equal(resolveDisplayDecimalPlaces("12.50"), 2);

console.log("scrub number math tests passed");
