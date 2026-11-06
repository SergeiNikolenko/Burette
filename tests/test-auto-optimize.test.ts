import { expect, test } from 'bun:test';
import { startAutoOptimize, type AutoOptimizeFrame } from '../apps/desktop/src/lib/molecular-workbench/auto-optimize-client';
import { parseMolecule } from '../apps/desktop/src/lib/molecular-workbench/chemistry';

const distance = (a: { x: number; y: number; z: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const DEPTH = 100 / 4.184, PAIR = 2 * 1.83;

test('Auto Optimize keeps relaxing in a real worker and dragged atoms hold their positions', async () => {
  const argon = parseMolecule('3\nAr3\nAr 0 0 0\nAr 3.1 0.4 0\nAr 1.2 2.9 0.3\n', 'xyz');
  let settle: (frame: AutoOptimizeFrame) => void = () => {};
  const settled = () => new Promise<AutoOptimizeFrame>((resolve) => { settle = resolve; });
  const frames: AutoOptimizeFrame[] = [];
  let failure: string | null = null;
  let next = settled();
  const session = startAutoOptimize({ type: 'start', molecule: argon, forceField: 'LJ', method: 'hybrid', constraints: [] },
    (frame) => { frames.push(frame); if (frame.settled) settle(frame); }, (message) => { failure = message; });
  try {
    const relaxed = await next;
    const [a, b, c] = relaxed.atoms;
    for (const [p, q] of [[a, b], [b, c], [a, c]]) expect(distance(p, q)).toBeCloseTo(PAIR, 3);
    expect(relaxed.energy).toBeCloseTo(-3 * DEPTH, 4);
    expect(relaxed.initialEnergy).toBeGreaterThan(relaxed.energy);
    // Frames arrive chunk by chunk while the structure relaxes.
    expect(frames.length).toBeGreaterThan(1);

    next = settled();
    session.move([0], [[a.x + 2, a.y, a.z]]);
    const dragged = await next;
    const [held, p, q] = dragged.atoms;
    expect([held.x, held.y, held.z]).toEqual([a.x + 2, a.y, a.z]);
    for (const [u, v] of [[held, p], [p, q], [held, q]]) expect(distance(u, v)).toBeCloseTo(PAIR, 3);
    expect(dragged.iterations).toBeGreaterThan(relaxed.iterations);
    expect(failure).toBeNull();
  } finally { session.stop(); }
});

test('Auto Optimize reports moves to atoms that do not exist', async () => {
  const argon = parseMolecule('2\nAr2\nAr 0 0 0\nAr 3 0 0\n', 'xyz');
  const failure = new Promise<string>((resolve) => {
    const session = startAutoOptimize({ type: 'start', molecule: argon, forceField: 'LJ', method: 'hybrid', constraints: [] },
      (frame) => { if (frame.settled) session.move([5], [[0, 0, 0]]); }, (message) => { session.stop(); resolve(message); });
  });
  expect(await failure).toBe('Moved atoms must exist and have finite positions.');
});
