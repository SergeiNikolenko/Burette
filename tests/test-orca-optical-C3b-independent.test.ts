import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readOrcaOpticalTables } from "../apps/desktop/src/lib/molecular-workbench/orca-optical-spectra";
const original = readFileSync(new URL("./fixtures/quantum/spectra-orca-camphor.out", import.meta.url), "utf8");
for (const [name, declaredUnit] of [["empty", ""], ["overlong", "x".repeat(129)]] as const) {
  test(`independent: malformed ${name} CD signal unit refuses the complete read`, () => {
    const text = original.replace("(1e40*cgs)", `(${declaredUnit})`);
    expect(text).not.toBe(original);
    expect(() => readOrcaOpticalTables(text)).toThrow();
  });
}
