import { OrderedSet } from 'molstar/lib/mol-data/int.js';

// CPU fields only: no representations, WebGL resources, structures or units
// are retained by the LRU. Eviction drops both arrays and their input snapshot.
// Mol*'s mesh/wireframe/floodfill consumers read these fields without mutation.
export class MolecularSurfaceFieldCache {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.units = new WeakMap();
    this.entries = new Map();
  }

  evict(entry) {
    if (!this.entries.delete(entry)) return;
    this.bytes -= entry.bytes;
    entry.field = undefined;
    entry.input = undefined;
  }

  async getOrCreate(unit, input, calculate) {
    const n = OrderedSet.size(input.position.indices);
    // Avoid allocating large input snapshots for protein/assembly surfaces.
    if (n > 4096) return calculate();
    const signature = fieldInput(input, n);
    let entry = this.units.get(unit);
    if (entry?.field && sameInput(entry.input, signature)) {
      this.entries.delete(entry);
      this.entries.set(entry, true);
      return entry.field;
    }
    if (entry) this.evict(entry);
    entry = {};
    this.units.set(unit, entry);
    // Never publish rejected/aborted calculations, or superseded requests.
    const field = await calculate();
    const bytes = field.field.data.byteLength + field.idField.data.byteLength
      + field.transform.length * 8 + signature.byteLength;
    if (this.units.get(unit) !== entry || bytes > this.maxBytes
      || !sameInput(signature, fieldInput(input, n))) return field;
    while (this.bytes + bytes > this.maxBytes) this.evict(this.entries.keys().next().value);
    Object.assign(entry, { field, input: signature, bytes });
    this.entries.set(entry, true);
    this.bytes += bytes;
    return field;
  }
}

function sameInput(a, b) {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

function fieldInput({ position, boundary, maxRadius, props }, n) {
  // Capture actual inputs, not object identity or a collision-prone hash.
  // This catches in-place coordinates/radii, selection/H changes, group IDs,
  // and effective quality resolution/probe parameters. Color/alpha are absent.
  const values = new Float64Array(10 + n * 6);
  values.set([props.resolution, props.probeRadius, props.probePositions, maxRadius,
    ...boundary.box.min, ...boundary.box.max]);
  for (let i = 0; i < n; i++) {
    const j = OrderedSet.getAt(position.indices, i);
    values.set([j, position.x[j], position.y[j], position.z[j], position.radius[j], position.id[i]], 10 + i * 6);
  }
  return values;
}
