import type { MolecularAtom, MolecularBond } from "./types";
export type { MolecularBond } from "./types";

export type PolymerOptions = {
  head: number; tail: number; headLeaving: number; tailLeaving: number;
  count: number; bondLength: number; endGroups?: "hydrogen" | "open";
  tacticity?: { kind: "isotactic" | "syndiotactic" } | { kind: "atactic"; alternatives: readonly (0 | 1)[] };
};

// Explicit bonds and replaceable hydrogens are required: XYZ distances alone do not
// establish bond order or attachment chemistry. The result is an unrelaxed starting geometry.
export function buildPolymer(atoms: MolecularAtom[], bonds: MolecularBond[], options: PolymerOptions) {
  const { head, tail, headLeaving, tailLeaving, count, bondLength, endGroups = "hydrogen" } = options;
  if (!Number.isInteger(count) || count < 1 || count > 500 || atoms.length * count > 100_000) throw new Error("Choose 1–500 repeats within the 100000-atom budget.");
  if (new Set([head, tail, headLeaving, tailLeaving]).size !== 4 || [head, tail, headLeaving, tailLeaving].some(index => !Number.isInteger(index) || index < 0 || index >= atoms.length)) throw new Error("Choose distinct attachment atoms and their leaving hydrogens.");
  if (!Number.isFinite(bondLength) || bondLength < 0.5 || bondLength > 3) throw new Error("The new single-bond length must be between 0.5 and 3 Å.");
  if (endGroups !== "hydrogen") throw new Error("Open polymer ends are not supported: their terminal valence is not preserved by molecular export. Choose hydrogen ends.");
  if (atoms.some(atom => ![atom.x, atom.y, atom.z].every(Number.isFinite))) throw new Error("Atom coordinates must be finite.");
  const valence = atoms.map(() => 0);
  const adjacency = atoms.map(() => [] as number[]);
  const seen = new Set<string>();
  for (const bond of bonds) {
    if (![bond.a, bond.b].every(index => Number.isInteger(index) && index >= 0 && index < atoms.length) || bond.a === bond.b || ![1, 1.5, 2, 3].includes(bond.order)) throw new Error("The repeat unit has an invalid bond graph.");
    const key = [bond.a, bond.b].sort((a, b) => a - b).join(":");
    if (seen.has(key)) throw new Error("The repeat unit has duplicate bonds.");
    seen.add(key);
    valence[bond.a] += bond.order; valence[bond.b] += bond.order;
    adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a);
  }
  const limits: Record<string, number> = { H: 1, B: 4, C: 4, N: 4, O: 2, F: 1, Si: 4, P: 5, S: 6, Cl: 1, Br: 1, I: 1 };
  atoms.forEach((atom, index) => {
    if (limits[atom.element] === undefined || valence[index] > limits[atom.element]) throw new Error("The repeat unit contains an unsupported element or excessive valence.");
  });
  for (const [attachment, leaving] of [[head, headLeaving], [tail, tailLeaving]]) {
    if (atoms[leaving].element !== "H" || adjacency[leaving].length !== 1 || adjacency[leaving][0] !== attachment || valence[leaving] !== 1 || atoms[attachment].element === "H") throw new Error("Each leaving atom must be a singly bonded hydrogen on its attachment atom.");
  }
  const repeatAlternatives: (0 | 1)[] = Array(count).fill(0);
  let alternateLeaving = tailLeaving;
  if (options.tacticity) {
    const { kind } = options.tacticity;
    if (!["isotactic", "syndiotactic", "atactic"].includes(kind)) throw new Error("Unsupported polymer tacticity.");
    const hydrogens = adjacency[tail].filter(index => atoms[index].element === "H");
    const heavy = adjacency[tail].filter(index => atoms[index].element !== "H");
    if (atoms[head].element !== "C" || atoms[tail].element !== "C" || hydrogens.length !== 2 || heavy.length !== 2 || !heavy.includes(head)
      || heavy.some(index => atoms[index].element !== "C") || valence[tail] !== 4
      || hydrogens.some(index => adjacency[index].length !== 1 || valence[index] !== 1)) throw new Error("Tacticity requires a directly connected C-head / CH2-tail vinyl repeat with two distinct leaving-H alternatives.");
    alternateLeaving = hydrogens.find(index => index !== tailLeaving)!;
    if (kind === "syndiotactic") for (let i = 0; i < count; i++) repeatAlternatives[i] = i % 2 as 0 | 1;
    if (options.tacticity.kind === "atactic") {
      const choices = options.tacticity.alternatives;
      if (choices.length !== count || Array.from(choices).some(choice => choice !== 0 && choice !== 1)) throw new Error("Atactic construction requires one resolved binary alternative per repeat.");
      choices.forEach((choice, i) => { repeatAlternatives[i] = choice; });
    }
  }
  const tailLeavingByRepeat = repeatAlternatives.map(choice => choice ? alternateLeaving : tailLeaving);
  const visited = new Set([head]);
  const pending = [head];
  while (pending.length) for (const next of adjacency[pending.pop()!]) if (!visited.has(next)) { visited.add(next); pending.push(next); }
  if (visited.size !== atoms.length) throw new Error("Use one connected molecule as the repeat unit.");
  const delta = [atoms[tail].x - atoms[head].x, atoms[tail].y - atoms[head].y, atoms[tail].z - atoms[head].z];
  const length = Math.hypot(...delta);
  if (!Number.isFinite(length) || length < 0.1) throw new Error("Attachment atoms must be separated.");
  const position = (index: number) => [atoms[index].x, atoms[index].y, atoms[index].z];
  const subtract = (a: number[], b: number[]) => a.map((value, i) => value - b[i]);
  const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (v: number[]) => { const norm = Math.hypot(...v); if (!Number.isFinite(norm) || norm < 1e-8) throw new Error("Attachment bonds must have a nonzero direction."); return v.map(value => value / norm); };
  const perpendicular = (v: number[], axis: number[]) => v.map((value, i) => value - dot(v, axis) * axis[i]);
  const headPosition = position(head), headDirection = unit(subtract(position(headLeaving), headPosition));
  const tailDirection = unit(subtract(position(tailLeaving), position(tail)));
  if (options.tacticity) {
    const branch = adjacency[tail].find(index => index !== head && atoms[index].element !== "H")!;
    // RDKit 2026.03.6 assignChiralTypesFrom3D uses |triple product| > 0.1 Å³.
    // Require every neighbor triple to survive that threshold in any atom order.
    // SDF rounds to 0.0001 Å: each center-to-neighbor vector's error is bounded
    // by sqrt(3)*0.0001. Expanding the determinant gives the rounding margin.
    const epsilon = Math.sqrt(3) * 0.0001;
    for (const leaving of [tailLeaving, alternateLeaving]) {
      const kept = leaving === tailLeaving ? alternateLeaving : tailLeaving;
      const replacement = unit(subtract(position(leaving), position(tail))).map((value, i) => position(tail)[i] + bondLength * value);
      const neighbors = [position(head), position(branch), position(kept), replacement].map(point => subtract(point, position(tail)));
      let handedness = 0;
      for (let omitted = 0; omitted < 4; omitted++) {
        const vectors = neighbors.filter((_, index) => index !== omitted);
        const [a, b, c] = vectors.map(vector => Math.hypot(...vector));
        const uncertainty = epsilon * (a * b + a * c + b * c) + epsilon ** 2 * (a + b + c) + epsilon ** 3;
        const orientation = dot(vectors[0], cross(vectors[1], vectors[2]));
        const sign = Math.sign(orientation) * (omitted % 2 ? -1 : 1);
        if (!Number.isFinite(orientation) || Math.abs(orientation) <= 0.1 + uncertainty || handedness && sign !== handedness) throw new Error("This local tacticity site is not a resolved tetrahedron at molecular export precision.");
        handedness = sign;
      }
    }
  }
  let frameReference = perpendicular(delta, headDirection);
  if (Math.hypot(...frameReference) < 1e-8) frameReference = perpendicular(tailDirection, headDirection);
  const linearAttachments = Math.hypot(...frameReference) < 1e-8;
  // Opposed collinear ends carry the previous frame unchanged. Same-direction
  // collinear ends do not define a molecular roll, so no arbitrary world axis is used.
  if (count > 1 && linearAttachments && dot(headDirection, tailDirection) > -1 + 1e-8) throw new Error("These collinear attachment directions do not define a repeat orientation.");
  const sourceY = linearAttachments ? [] : unit(frameReference), sourceZ = linearAttachments ? [] : cross(headDirection, sourceY);
  let rotate = (v: number[]) => [...v], origin = headPosition;
  const output: MolecularAtom[] = [];
  const outputBonds: MolecularBond[] = [];
  const maps: Map<number, number>[] = [];
  const sourceAtomIndices: number[] = [], repeatIndices: number[] = [];
  for (let repeat = 0; repeat < count; repeat++) {
    if (repeat > 0) {
      const previousTail = rotate(delta).map((value, i) => value + origin[i]);
      const outgoing = rotate(unit(subtract(position(tailLeavingByRepeat[repeat - 1]), position(tail))));
      const targetX = outgoing.map(value => -value);
      if (!linearAttachments) {
        let reference = perpendicular(rotate(delta), targetX);
        if (Math.hypot(...reference) < 1e-8) reference = perpendicular(rotate(headDirection).map(value => -value), targetX);
        const targetY = unit(reference), targetZ = cross(targetX, targetY);
        // Two right-handed orthonormal frames define a proper rigid rotation.
        rotate = (v: number[]) => targetX.map((value, i) => value * dot(v, headDirection) + targetY[i] * dot(v, sourceY) + targetZ[i] * dot(v, sourceZ));
      }
      origin = previousTail.map((value, i) => value + bondLength * outgoing[i]);
    }
    const map = new Map<number, number>();
    atoms.forEach((atom, index) => {
      if ((index === headLeaving && repeat > 0) || (index === tailLeavingByRepeat[repeat] && repeat < count - 1)) return;
      map.set(index, output.length);
      const xyz = repeat === 0 ? position(index) : rotate(subtract(position(index), headPosition)).map((value, i) => value + origin[i]);
      if (xyz.some(value => !Number.isFinite(value))) throw new Error("Polymer coordinates exceed the finite coordinate range.");
      output.push({ ...atom, x: xyz[0], y: xyz[1], z: xyz[2] });
      sourceAtomIndices.push(index); repeatIndices.push(repeat);
    });
    for (const bond of bonds) if (map.has(bond.a) && map.has(bond.b)) outputBonds.push({ a: map.get(bond.a)!, b: map.get(bond.b)!, order: bond.order });
    if (repeat) outputBonds.push({ a: maps[repeat - 1].get(tail)!, b: map.get(head)!, order: 1 });
    maps.push(map);
  }
  // A spatial hash bounds overlap detection independently of repeat-unit size.
  const grid = new Map<string, { atom: MolecularAtom; repeat: number }[]>();
  for (let repeat = 0; repeat < maps.length; repeat++) for (const index of maps[repeat].values()) {
    const atom = output[index];
    const key = [atom.x, atom.y, atom.z].map(value => Math.floor(value / 0.6));
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const entries = grid.get([key[0] + i, key[1] + j, key[2] + k].join(":")) ?? [];
      if (entries.some(entry => entry.repeat !== repeat && Math.hypot(atom.x - entry.atom.x, atom.y - entry.atom.y, atom.z - entry.atom.z) < 0.6)) throw new Error("Repeat units overlap. Choose different attachment atoms or a longer bond.");
    }
    const bucket = key.join(":");
    const entries = grid.get(bucket) ?? [];
    if (entries.length >= 64) throw new Error("The repeat unit contains an excessively crowded region.");
    entries.push({ atom, repeat });
    grid.set(bucket, entries);
  }
  return { atoms: output, bonds: outputBonds, sourceAtomIndices, repeatIndices, repeatAlternatives, requiresRelaxation: true as const };
}
