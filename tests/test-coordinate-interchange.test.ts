import { expect, test } from "bun:test";
import { readCoordinateInterchange as read, writeCoordinateInterchange as write, type CoordinateInterchange } from "../scripts/coordinate-interchange.mjs";

const tag = "BURETTE_INTERNAL_COORDINATES_V1=";
const xyz = (atoms: CoordinateInterchange["atoms"], comment = "sample") => `${atoms.length}\n${comment}\n${atoms.map(a => `${a.element} ${a.x} ${a.y} ${a.z}`).join("\n")}\n`;
const atom = (element: string, x: number, y: number, z: number) => ({ element, x, y, z });
const symbol = `# source burette-import-123
C
X 1 DX
H 1 R 2 A
F 1 +R 2 A 3 -P

DX = 1
R = 1.09
A = 109.5
P = 60
UNUSED = -17.125
`;
const encoded = (pair: unknown) => Buffer.from(JSON.stringify(pair)).toString("base64url");
const marked = (body: string, payload: string) => { const lines = body.split("\n"); lines[1] += ` ${tag}${payload}`; return lines.join("\n"); };
function invalid(run: () => unknown, code = "INVALID_COORDINATES") { expect(run).toThrow(expect.objectContaining({ code })); }

for (const [name, atoms] of [
  ["one translated atom", [atom("He", 42.1234567890123, -12, 7)]],
  ["rotated translated pair", [atom("H", 1, 2, 3), atom("F", 1.5, 2.25, 3.75)]],
  ["chiral world pose", [atom("C", 3, -2, 5), atom("F", 4, -1, 6), atom("Cl", 2, -3, 6), atom("Br", 2, -1, 4), atom("I", 4, -3, 4)]],
  ["collinear leading rows", [atom("C", 3, 2, 1), atom("C", 4, 2, 1), atom("C", 5, 2, 1), atom("H", 4, 3, 2)]],
  ["near-collinear leading rows", [atom("C", 3, 2, 1), atom("C", 4, 2, 1), atom("C", 5, 2 + 1e-8, 1), atom("H", 4, 3, 2)]],
] as const) test(`${name}: roundtrip retains every unaligned Cartesian number`, () => {
  const expected = [...atoms], original = read(xyz(expected, "pose token-123"), "xyz");
  const zmat = write(original, "zmat", original.comment), restored = read(zmat, "zmat");
  const output = read(write(restored, "xyz", restored.comment), "xyz");
  expect(output.atoms).toEqual(expected);
  expect(output.comment).toBe("pose token-123");
  expect(output.internalCoordinates).toEqual(original.internalCoordinates);
  expect(write(original, "zmat", original.comment)).toBe(zmat);
  expected.forEach((a, i) => { for (const key of ["x", "y", "z"] as const) expect(Math.abs(output.atoms[i][key] - a[key])).toBeLessThanOrEqual(1e-12); });
});

test("signed/shared/unused variables and dummy rows survive the same single marker in both formats", () => {
  const source = read(symbol, "zmat"), output = write(source, "xyz", source.comment);
  expect(source.atoms.map(a => a.element)).toEqual(["C", "H", "F"]);
  expect(source.internalCoordinates.rows).toHaveLength(4);
  expect(read(output, "xyz")).toEqual(source);
  expect(read(write(read(output, "xyz"), "zmat", source.comment), "zmat")).toEqual(source);
  expect(output.split(tag)).toHaveLength(2);
  const changed = structuredClone(source); changed.internalCoordinates.variables.at(-1)!.value = 99;
  const revised = write(changed, "xyz", source.comment);
  expect(revised).not.toBe(output);
  expect(revised.split("\n").slice(2)).toEqual(output.split("\n").slice(2));
  expect(read(revised, "xyz").internalCoordinates.variables.at(-1)!.value).toBe(99);
  const referenceOnly = structuredClone(source); referenceOnly.internalCoordinates.variables[0].value = 2;
  const referenceOutput = write(referenceOnly, "xyz", source.comment);
  expect(referenceOutput.split("\n").slice(2)).toEqual(output.split("\n").slice(2));
  expect(read(referenceOutput, "xyz").internalCoordinates.variables[0].value).toBe(2);
});

test("only the recognized terminal legacy discriminator migrates; human text/import identity remain exact", () => {
  const pair = read(symbol, "zmat");
  const comment = "  user sample  burette-import-123";
  const migrated = write(pair, "xyz", `${comment} zdef-0123abcd`);
  expect(read(migrated, "xyz").comment).toBe(comment);
  expect(migrated).not.toContain("zdef-0123abcd"); expect(migrated.split(tag)).toHaveLength(2);
  for (const similar of ["zdef-0123abcd", "sample zdef-0123abcd tail", "sample zdef-0123ABCd", "sample zdef-0123abcd ", "sample-zdef-0123abcd"]) {
    expect(read(write(pair, "xyz", similar), "xyz").comment).toBe(similar);
  }
  expect(read(write(pair, "zmat", comment), "zmat").comment).toBe(comment);
});

test("conflicting absolute rows and semantic definitions are refused rather than repaired", () => {
  const pair = read(symbol, "zmat"), output = write(pair, "xyz");
  const lines = output.split("\n"); lines[2] = "C 0.000000000001 0 0";
  invalid(() => read(lines.join("\n"), "xyz"));
  invalid(() => read(write(pair, "zmat").replace("UNUSED = -17.125", "UNUSED = 4"), "zmat"));
  const moved = structuredClone(pair); moved.atoms[2].x += 0.2;
  invalid(() => write(moved, "xyz"));
  const mirrored = read(xyz([atom("C", 0, 0, 0), atom("F", 1, 0, 0), atom("Cl", 0, 1, 0), atom("Br", 0, 0, 1)]), "xyz");
  mirrored.atoms[3].z = -1; invalid(() => write(mirrored, "xyz"));
});

test("malformed, duplicate, unsupported and misplaced markers never fall back to bare geometry", () => {
  const pair = read(symbol, "zmat"), body = xyz(pair.atoms), payload = encoded({ atoms: pair.atoms, internalCoordinates: pair.internalCoordinates });
  for (const bad of ["not-base64!", "a", "e30=", Buffer.from([0xff]).toString("base64url"), encoded({ ...pair, extra: true }), encoded({ atoms: [], internalCoordinates: pair.internalCoordinates })]) {
    expect(() => read(marked(body, bad), "xyz")).toThrow();
  }
  const good = marked(body, payload);
  invalid(() => read(good.replace(tag, "BURETTE_INTERNAL_COORDINATES_V2="), "xyz"));
  invalid(() => read(good.replace(tag + payload, `${tag}${payload} ${tag}${payload}`), "xyz"));
  invalid(() => read(body + `# ${tag}${payload}\n`, "xyz"));
  invalid(() => read(`C # ${tag}${payload}\n`, "zmat"));
  invalid(() => read(write(pair, "zmat") + `# ${tag}${payload}\n`, "zmat"));
  invalid(() => write(pair, "xyz", "two\nlines"));
});

test("file/output, definition-row and variable bounds admit no partially useful result", () => {
  const pair = read("H\n", "zmat");
  invalid(() => read("x".repeat(1048577), "xyz"), "COORDINATE_LIMIT");
  invalid(() => write(pair, "xyz", "x".repeat(1048500)), "COORDINATE_LIMIT");
  invalid(() => read("513\ncomment\n", "xyz"), "COORDINATE_LIMIT");
  const tooManyRows = structuredClone(pair); tooManyRows.internalCoordinates.rows = Array.from({ length: 513 }, () => ({ element: "X", refs: [], values: [] }));
  invalid(() => write(tooManyRows, "xyz"), "COORDINATE_LIMIT");
  const tooManyVariables = structuredClone(pair); tooManyVariables.internalCoordinates.variables = Array.from({ length: 1537 }, (_, i) => ({ name: `V${i}`, value: i }));
  invalid(() => write(tooManyVariables, "xyz"), "COORDINATE_LIMIT");
  invalid(() => read(xyz(pair.atoms) + xyz(pair.atoms), "xyz"));
  invalid(() => read("1\nProperties=species:S:1:pos:R:3:charge:R:1\nH 0 0 0 0\n", "xyz"));
  expect(read(write(pair, "xyz"), "xyz").atoms).toEqual(pair.atoms);
});
