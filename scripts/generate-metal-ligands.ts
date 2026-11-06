// Regenerates apps/desktop/src/lib/molecular-workbench/metal-ligands.json from an OpenChemistry/fragments checkout:
//   git -C <fragments> checkout 7d842f435aec4729a308b23ad7f9501bdd44aa02
//   bun scripts/generate-metal-ligands.ts <fragments> > apps/desktop/src/lib/molecular-workbench/metal-ligands.json
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = process.argv[2];
if (!root) throw new Error("Pass the OpenChemistry/fragments checkout directory.");
const commit = "7d842f435aec4729a308b23ad7f9501bdd44aa02";
const symbols: Record<number, string> = { 1: "H", 5: "B", 6: "C", 7: "N", 8: "O", 9: "F", 15: "P", 16: "S", 17: "Cl", 35: "Br", 53: "I" };
const VALENCE: Record<string, number> = { H: 1, B: 3, C: 4, N: 3, O: 2, F: 1, P: 3, S: 2, Cl: 1, Br: 1, I: 1 };
/**
 * Corrections are in the file's own atom indices. `drop` removes atoms, `addNH` puts the H an sp3
 * amine donor lacks opposite its other neighbours, `orders` replaces bond orders, `charges`
 * overrides the valence rule (a carbene or a carbocation looks like a carbanion to it).
 */
type Spec = { id: string; file: string; label: string; formula: string; drop?: number[]; addNH?: number[]; orders?: [number, number, number][]; charges?: Record<number, number>; derived?: string };
const L = (group: string) => (id: string, file: string, label: string, formula: string, fix: Partial<Spec> = {}): Spec => ({ id, file: `ligands/${group}/${file}.cjson`, label, formula, ...fix });
const mono = L("monodentate"), bi = L("bidentate"), tri = L("tridentate"), tetra = L("tetradentate"), hexa = L("hexadentate"), eta = L("haptic");
// Indenyl's two files give one carbon two double bonds; this is the indenide Kekulé structure (C2⁻).
const INDENYL: [number, number, number][] = [[0, 8, 1], [0, 1, 2], [1, 2, 1]];
const specs: Spec[] = [
  mono("aqua", "aqua", "H₂O (aqua)", "H2O"),
  mono("hydroxido", "aqua", "OH⁻ (hydroxido)", "OH", { drop: [3], derived: "aqua.cjson with one H removed" }),
  mono("ammine", "ammine", "NH₃ (ammine)", "NH3"),
  mono("fluorido", "fluorido", "F⁻ (fluorido)", "F"),
  mono("chlorido", "chlorido", "Cl⁻ (chlorido)", "Cl"),
  mono("bromido", "bromido", "Br⁻ (bromido)", "Br"),
  mono("iodido", "iodido", "I⁻ (iodido)", "I"),
  mono("cyanido", "cyano", "CN⁻ (cyanido)", "CN"),
  mono("carbonyl", "carbonyl", "CO (carbonyl)", "CO"),
  mono("phosphane", "phosphine", "PH₃ (phosphane)", "PH3"),
  mono("trimethylphosphane", "trimethylphosphine", "PMe₃ (trimethylphosphane)", "PMe3"),
  mono("pyridine", "pyridyl", "py (pyridine)", "py"),
  mono("triphenylphosphane", "triphenylphosphine", "PPh₃ (triphenylphosphane)", "PPh3"),
  mono("trimethylamine", "trimethylammonium", "NMe₃ (trimethylamine)", "NMe3"),
  mono("diethyl-ether", "diethylether", "Et₂O (diethyl ether)", "OEt2"),
  mono("tetrahydrofuran", "tetrahydrofurane", "THF (tetrahydrofuran)", "thf"),
  mono("dimethyl-sulfide", "dimethylsulfide", "SMe₂ (dimethyl sulfide)", "SMe2"),
  mono("sulfanido", "thiol", "SH⁻ (sulfanido)", "SH"),
  mono("azido", "azido", "N₃⁻ (azido)", "N3"),
  // The file draws N=C with a bare carbon; N-bound cyanide is N≡C⁻.
  mono("isocyanido", "isocyano", "NC⁻ (isocyanido)", "NC", { orders: [[1, 2, 3]] }),
  mono("nitrito-n", "nitro", "NO₂⁻ (nitrito-N)", "NO2"),
  mono("nitrosyl", "nitrosyl", "NO⁺ (nitrosyl)", "NO"),
  mono("thiocyanato-n", "thiocyanato-N", "NCS⁻ (thiocyanato-N)", "NCS"),
  mono("thiocyanato-s", "thiocyano", "SCN⁻ (thiocyanato-S)", "SCN"),
  mono("methyl", "methyl", "Me⁻ (methyl)", "Me"),
  mono("ethyl", "ethyl", "Et⁻ (ethyl)", "Et"),
  mono("propyl", "propyl", "nPr⁻ (propyl)", "nPr"),
  mono("isopropyl", "isopropyl", "iPr⁻ (isopropyl)", "iPr"),
  mono("tert-butyl", "t-butyl", "tBu⁻ (tert-butyl)", "tBu"),
  mono("simes", "simes", "SIMes (N-heterocyclic carbene)", "SIMes", { charges: { 12: 0 } }),
  bi("ethylenediamine", "en-ethylenediamine", "en (ethylenediamine)", "en"),
  bi("bipyridine", "bpy-bipyridine", "bpy (2,2′-bipyridine)", "bpy"),
  bi("phenanthroline", "phenanthroline", "phen (1,10-phenanthroline)", "phen"),
  bi("oxalato", "oxalate", "ox²⁻ (oxalato)", "ox"),
  bi("acetylacetonato", "acac-acetylacetonate", "acac⁻ (acetylacetonato)", "acac"),
  bi("tmeda", "tmeda-tetramethylethylenediamine", "tmeda (tetramethylethylenediamine)", "tmeda"),
  bi("dmpe", "dmpe-1,2-bis(dimethylphosphino)ethane", "dmpe (1,2-bis(dimethylphosphino)ethane)", "dmpe"),
  bi("dppe", "dppe-1,2-bis(diphenylphosphino)ethane", "dppe (1,2-bis(diphenylphosphino)ethane)", "dppe"),
  bi("quinolinolato", "8-hydroxyquinoline", "quin⁻ (8-quinolinolato)", "quin"),
  bi("dimethylglyoxime", "dimethylglyoxime", "dmgH₂ (dimethylglyoxime)", "dmgH2"),
  bi("ethenedithiolato", "dithiolene", "S₂C₂H₂²⁻ (ethenedithiolato)", "S2C2H2"),
  tri("diethylenetriamine", "dien-diethylenetriamine", "dien (diethylenetriamine)", "dien"),
  tri("iminodiacetato", "ida-iminodiacetate", "ida²⁻ (iminodiacetato)", "ida"),
  tri("terpyridine", "terpyridine", "terpy (2,2′:6′,2″-terpyridine)", "terpy"),
  tri("tacn", "tacn-147-triazacyclononane", "tacn (1,4,7-triazacyclononane)", "tacn", { addNH: [3, 6, 9] }),
  // Thioether sulfurs carry no hydrogen.
  tri("trithiacyclononane", "9-ane-S3", "[9]aneS₃ (1,4,7-trithiacyclononane)", "9S3", { drop: [10, 15, 20] }),
  tri("scorpionate", "tp-scorpionate", "Tp⁻ (hydrotris(pyrazolyl)borato)", "Tp"),
  tri("triphos", "triphos", "triphos (1,1,1-tris(diphenylphosphinomethyl)ethane)", "triphos"),
  // The tertiary amine nitrogen carries no hydrogen.
  tetra("nitrilotriacetato", "nta-nitrilotriacetate", "nta³⁻ (nitrilotriacetato)", "nta", { drop: [16] }),
  tetra("tpa", "tpa-tris-2-pyridylmethyl-amine", "tpa (tris(2-pyridylmethyl)amine)", "tpa", { drop: [29] }),
  tetra("triethylenetetramine", "trien-triethylenetetramine", "trien (triethylenetetramine)", "trien"),
  tetra("cyclen", "cyclen", "cyclen (1,4,7,10-tetraazacyclododecane)", "cyclen", { addNH: [1, 4, 7, 10] }),
  tetra("cyclam", "cyclam", "cyclam (1,4,8,11-tetraazacyclotetradecane)", "cyclam", { addNH: [1, 4, 8, 11] }),
  tetra("salen", "salen", "salen²⁻ (N,N′-bis(salicylidene)ethylenediamine)", "salen"),
  tetra("porphyrinato", "porphin", "porphin²⁻ (porphyrinato)", "por"),
  tetra("phthalocyaninato", "phthalocyanine", "pc²⁻ (phthalocyaninato)", "pc"),
  tetra("12-crown-4", "12-crown-4", "12-crown-4", "12C4"),
  hexa("edta", "edta", "edta⁴⁻ (ethylenediaminetetraacetato)", "edta"),
  // tpen.cjson is left out: one pyridine N sits 1.5 Å from the metal and its donor angles fit no polyhedron.
  hexa("18-crown-6", "18-crown-6", "18-crown-6", "18C6"),
  hexa("hexaaza-18-crown-6", "hexaaza-18-crown-6", "hexaaza-18-crown-6", "18N6", { addNH: [0, 3, 6, 9, 13, 16] }),
  eta("ethylene", "eta2-ethylene", "η²-C₂H₄ (ethylene)", "C2H4"),
  eta("acetylene", "eta2-acetylene", "η²-C₂H₂ (acetylene)", "C2H2"),
  eta("allyl", "eta3-alyl", "η³-C₃H₅⁻ (allyl)", "C3H5"),
  eta("cyclopropenyl", "eta3-cyclopropyl", "η³-C₃H₃⁺ (cyclopropenyl)", "C3H3", { charges: { 2: 1 } }),
  eta("eta3-cyclopentadienyl", "eta3-cyclopentyl", "η³-C₅H₅⁻ (cyclopentadienyl)", "C5H5"),
  eta("eta3-indenyl", "eta3-indenyl", "η³-C₉H₇⁻ (indenyl)", "ind", { orders: INDENYL }),
  eta("butadiene", "eta4-butadiene", "η⁴-C₄H₆ (butadiene)", "C4H6"),
  eta("cyclobutadiene", "eta4-cyclobutyl", "η⁴-C₄H₄ (cyclobutadiene)", "C4H4"),
  eta("eta4-cyclopentadienyl", "eta4-cyclopentyl", "η⁴-C₅H₅⁻ (cyclopentadienyl)", "C5H5"),
  eta("cyclooctadiene", "eta4-cyclo-octadiene", "η⁴-cod (1,5-cyclooctadiene)", "cod"),
  eta("cyclopentadienyl", "eta5-Cp-cyclopentyl", "η⁵-Cp⁻ (cyclopentadienyl)", "Cp"),
  eta("indenyl", "eta5-indenyl", "η⁵-C₉H₇⁻ (indenyl)", "ind", { orders: INDENYL }),
  // Fluorenyl draws C10 with two double bonds; C11 (position 9) is the carbanion.
  eta("fluorenyl", "eta5-fluorenyl", "η⁵-C₁₃H₉⁻ (fluorenyl)", "flu", { orders: [[10, 11, 1]] }),
  eta("benzene", "eta6-benzene", "η⁶-C₆H₆ (benzene)", "C6H6"),
  eta("tropylium", "eta7-cycloheptyl", "η⁷-C₇H₇⁺ (tropylium)", "C7H7", { charges: { 6: 1 } }),
  eta("cyclooctatetraene", "eta8-cyclooctyl", "η⁸-C₈H₈ (cyclooctatetraene)", "C8H8"),
];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(...a);
const round = (v: number) => Number(v.toFixed(4));
const ligands: Record<string, unknown> = {};
for (const spec of specs) {
  const bytes = readFileSync(`${root}/${spec.file}`), cjson = JSON.parse(bytes.toString("utf8"));
  const numbers: number[] = cjson.atoms.elements.number, flat: number[] = cjson.atoms.coords["3d"], index: number[] = cjson.bonds.connections.index;
  const point = (i: number): V3 => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]];
  const bonds = cjson.bonds.order.map((order: number, b: number) => [index[2 * b], index[2 * b + 1], order] as V3);
  for (const [a, b, order] of spec.orders ?? []) {
    const bond = bonds.find(([x, y]: V3) => (x === a && y === b) || (x === b && y === a));
    if (!bond) throw new Error(`${spec.file}: no bond ${a}-${b}`);
    bond[2] = order;
  }
  const dummies = numbers.flatMap((number, i) => number === 0 ? [i] : []);
  const atoms = numbers.map((number, i) => ({ old: i, element: symbols[number], position: point(i) })).filter(atom => atom.element && !spec.drop?.includes(atom.old));
  if (atoms.length + dummies.length + (spec.drop?.length ?? 0) !== numbers.length) throw new Error(`${spec.file}: unsupported element`);
  const neighbours = (i: number) => bonds.flatMap(([a, b]: V3) => a === i ? [b] : b === i ? [a] : []);
  for (const n of spec.addNH ?? []) {
    // Opposite the neighbours' mean direction, or the plane normal away from the metal, whichever keeps the H farther
    // from it: cyclen and cyclam draw planar nitrogens, whose H then sits about 2.1 Å from the metal until optimized.
    const units = neighbours(n).map(other => { const v = sub(point(other), point(n)); return v.map(x => x / len(v)) as V3; });
    const toward = units.reduce<V3>((sum, v) => [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]], [0, 0, 0]);
    const [a, b, c] = units, normal: V3 = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const metalward = sub(point(dummies[0]), point(n)), side = Math.sign(normal[0] * metalward[0] + normal[1] * metalward[1] + normal[2] * metalward[2]) || 1;
    const [h] = [toward, normal.map(x => x * side) as V3].map(away => [0, 1, 2].map(k => point(n)[k] - 1.01 * away[k] / len(away)) as V3)
      .sort((p, q) => len(sub(q, point(dummies[0]))) - len(sub(p, point(dummies[0]))));
    if (len(sub(h, point(dummies[0]))) < 2) throw new Error(`${spec.file}: the H added to N${n} points at the metal`);
    const id = -1 - atoms.length;
    atoms.push({ old: id, element: "H", position: h });
    bonds.push([n, id, 1]);
  }
  const map = new Map(atoms.map((atom, next) => [atom.old, next]));
  const kept = bonds.filter(([a, b]: V3) => map.has(a) && map.has(b)).map(([a, b, order]: V3) => [map.get(a)!, map.get(b)!, order] as V3);
  // A haptic template has two bonded dummies: the ring centroid and the metal 2 Å from it.
  const hapticity = Number(/eta(\d)/u.exec(spec.file)?.[1] ?? 0);
  let metal: V3, donors: number[], centroid: V3 | undefined;
  if (hapticity) {
    if (dummies.length !== 2) throw new Error(`${spec.file}: two haptic dummies expected`);
    const carbons = atoms.flatMap((atom, i) => atom.element === "C" ? [i] : []);
    const nearest = (to: V3) => [...carbons].sort((a, b) => len(sub(atoms[a].position, to)) - len(sub(atoms[b].position, to))).slice(0, hapticity);
    const mean = (indices: number[]): V3 => [0, 1, 2].map(k => indices.reduce((sum, i) => sum + atoms[i].position[k], 0) / indices.length) as V3;
    const [inside, outside] = [...dummies].sort((a, b) => len(sub(point(a), mean(nearest(point(a))))) - len(sub(point(b), mean(nearest(point(b))))));
    donors = nearest(point(inside)).sort((a, b) => a - b);
    if (len(sub(mean(donors), point(inside))) > 0.15) throw new Error(`${spec.file}: centroid dummy is not over ${hapticity} carbons`);
    centroid = mean(donors); metal = point(outside);
  } else {
    if (dummies.length !== 1) throw new Error(`${spec.file}: one attachment dummy expected`);
    metal = point(dummies[0]);
    donors = neighbours(dummies[0]).map(i => map.get(i)!).sort((a, b) => a - b);
  }
  // Ionic ligand model: each atom's charge is its bond-order sum minus its valence.
  const charges = atoms.map((atom, i) => {
    if (spec.charges && atom.old in spec.charges) return spec.charges[atom.old];
    const sum = kept.reduce((total, [a, b, order]) => total + (a === i || b === i ? order : 0), 0), valence = VALENCE[atom.element];
    if (sum === valence) return 0;
    if (atom.element === "B" && sum === 4) return -1;
    if (sum === valence + 1 && ["N", "O", "P", "S"].includes(atom.element)) return 1;
    if (sum === valence - 1) return -1;
    throw new Error(`${spec.file}: ${atom.element}${atom.old} has bond order ${sum}`);
  });
  ligands[spec.id] = { label: spec.label, formula: spec.formula, file: spec.file, sha256: createHash("sha256").update(bytes).digest("hex"), ...(spec.derived ? { derived: spec.derived } : {}),
    metal: metal.map(round), ...(centroid ? { centroid: centroid.map(round) } : {}), donors,
    atoms: atoms.map((atom, i) => [atom.element, ...atom.position.map(round), charges[i]]), bonds: kept };
}
const out = { source: { repository: "https://github.com/OpenChemistry/fragments", commit, license: "BSD-3-Clause",
  note: "Coordinates and covalent bonds copied from the listed CJSON files with the corrections in scripts/generate-metal-ligands.ts; the attachment dummy is stored as `metal`, a haptic ring's centroid dummy as `centroid` with its carbons as donors; formal charges follow the bond orders (dative, ionic ligand model)." }, ligands };
// Numeric tuples stay on one line.
const text = JSON.stringify(out, null, 2).replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (_, body) => `[${body.replace(/\s+/g, " ")}]`);
process.stdout.write(text + "\n");
