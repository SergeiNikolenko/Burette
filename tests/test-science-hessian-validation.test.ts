import { expect, test } from "bun:test";
import { XYZ, waterScience } from "./scientific-data-fixture";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { ScienceSessionError } from "../apps/desktop/src/lib/science-session/contracts";

function validWater() {
  const data = waterScience(), values = data.frames[0].hessian!.values;
  values[9] = values[1] + 0.0001;
  return data;
}

test("scientific Hessians retain numerical asymmetry but reject matrices the source reader would refuse", () => {
  const data = validWater(), values = data.frames[0].hessian!.values;
  expect(validateScientificDocument(data, readXyzFrames(XYZ))).toBe(data);
  expect(data.frames[0].hessian!.values).toBe(values);
  expect(values[9]).toBe(values[1] + 0.0001);
  values[9] = 0.2;
  expect(() => validateScientificDocument(data, readXyzFrames(XYZ))).toThrow(ScienceSessionError);
});
