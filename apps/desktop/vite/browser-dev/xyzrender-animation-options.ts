export function xyzrenderAnimationArguments(value: unknown, output: string): string[] {
  if (!value || typeof value !== 'object') throw new Error('Missing animation options');
  const input = value as Record<string, unknown>;
  const mode = String(input.mode || 'rotation');
  const axis = String(input.axis || 'y');
  if (!['rotation', 'bounce', 'trajectory', 'vibration', 'assembly'].includes(mode)) throw new Error('Unknown animation mode');
  if (!/^-?(?:x|y|z|xy|xz|yz|yx|zx|zy|\d{3})$/.test(axis)) throw new Error('Invalid rotation axis');
  const bounded = (name: string, fallback: number, min: number, max: number) => {
    const n = input[name] === undefined ? fallback : Number(input[name]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid animation ${name}: expected ${min}–${max}`);
    return n;
  };
  const size = bounded('size', 480, 128, 1024);
  const frames = bounded('frames', 120, 2, 240);
  const fps = bounded('fps', 10, 1, 30);
  if (![size, frames, fps].every(Number.isInteger)) throw new Error('Size, frames and fps must be integers');
  if (size * size * frames > 100_000_000) throw new Error('Use fewer frames or a smaller image');
  const args = ['-S', String(size), '--gif-fps', String(fps), '--rot-frames', String(frames), '-go', output];
  const rotationArgs = axis.startsWith('-') ? [`--gif-rot=${axis}`] : ['--gif-rot', axis];
  if (mode === 'rotation') args.push(...rotationArgs);
  if (mode === 'bounce') args.push('--gif-bounce', `${bounded('amplitude', 45, 1, 180)},${axis}`);
  if (mode === 'trajectory') { args.push('--gif-trj'); if (input.rebuildBonds === true) args.push('--trj-bonds'); }
  if (mode === 'vibration') args.push('--gif-ts', '--vib-frames', String(frames));
  if ((mode === 'vibration' || mode === 'trajectory') && input.rotate === true) args.push(...rotationArgs);
  if (mode === 'assembly') {
    args.push('--gif-diffuse', '--diffuse-frames', String(frames), '--diffuse-noise', String(bounded('noise', 0.3, 0, 5)));
    const bonds = String(input.bonds || 'fade');
    if (!['fade', 'show', 'hide'].includes(bonds)) throw new Error('Invalid assembly bonds');
    args.push('--diffuse-bonds', bonds);
    if (input.forward === true) args.push('--diffuse-forward');
    if (input.rotate === true) args.push(...rotationArgs, '--diffuse-rot', String(bounded('amplitude', 180, 1, 360)));
    if (input.anchor) {
      if (typeof input.anchor !== 'string' || input.anchor.length > 2000 || !/^[\w,\s-]+$/.test(input.anchor)) throw new Error('Invalid anchor selection');
      args.push('--anchor', input.anchor);
    }
  }
  return args;
}
