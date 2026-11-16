// The angle, in degrees, of the long axis of a 2D depiction: the principal axis of the atom positions in a V2000
// molblock. RDKit's `rotate` draw option turns the drawing by this angle so that the long axis lies across the picture.
export function depictionLongAxisAngle(molblock: string): number {
  const points: Array<[number, number]> = [];
  for (const line of molblock.split("\n").slice(4)) {
    const atom = /^\s*(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+-?\d+\.\d+\s+[A-Za-z*]/.exec(line);
    if (atom) points.push([Number(atom[1]), Number(atom[2])]);
    else if (points.length) break;
  }
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  let xx = 0, yy = 0, xy = 0;
  for (const [x, y] of points) {
    xx += (x - meanX) ** 2;
    yy += (y - meanY) ** 2;
    xy += (x - meanX) * (y - meanY);
  }
  return 0.5 * Math.atan2(2 * xy, xx - yy) * 180 / Math.PI;
}
