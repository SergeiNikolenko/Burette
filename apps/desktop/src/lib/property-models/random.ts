/** Deterministic generator (mulberry32): one seed gives the same folds and the same forest on every machine. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffled k-fold assignment: entry i is the fold that holds item i out. Fold sizes differ by at most one. */
export function assignFolds(count: number, folds: number, seed: number): Int32Array {
  const order = Int32Array.from({ length: count }, (_, index) => index);
  const random = seededRandom(seed);
  for (let last = count - 1; last > 0; last--) {
    const pick = Math.floor(random() * (last + 1));
    const held = order[last];
    order[last] = order[pick];
    order[pick] = held;
  }
  const fold = new Int32Array(count);
  for (let position = 0; position < count; position++) fold[order[position]] = position % folds;
  return fold;
}
