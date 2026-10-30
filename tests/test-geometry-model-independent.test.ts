import { expect, test } from 'bun:test';
import { geometryBase, geometryText, withInternalCoordinate, clampInternalCoordinate } from '../apps/desktop/src/lib/geometry-editing';
const xyz = '4\nrotated asymmetric molecule\nC 1.2 2.3 -0.5\nC 2.4 2.2 0.1\nO 2.8 3.5 0.4\nH 3.4 3.6 1.8\n';
type V = [number, number, number];
const sub = (a: number[], b: number[]): V => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n*b[i], 0);
const cross = (a: number[], b: number[]): V => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function signedDihedral(p0: number[], p1: number[], p2: number[], p3: number[]) {
 const axis = sub(p2,p1), length = Math.hypot(...axis), u = axis.map(n=>n/length);
 const a = sub(p0,p1), b = sub(p3,p2);
 const v = a.map((n,i)=>n-dot(a,u)*u[i]), w = b.map((n,i)=>n-dot(b,u)*u[i]);
 return Math.atan2(dot(cross(u,v),w), dot(v,w))*180/Math.PI;
}
test('independent: signed torsion changes only its placed atom and retains the original reference frame', () => {
 const base = geometryBase(xyz), refs = base.rows[3].refs;
 for (const target of [-179, -65.5, 0, 65.5, 179]) {
  const edited = geometryText(base, withInternalCoordinate(base.rows, 3, 2, target));
  expect(edited.split('\n').slice(0,5)).toEqual(xyz.split('\n').slice(0,5));
  const points = geometryBase(edited).atoms.map(atom=>atom.position);
  expect(signedDihedral(points[3], points[refs[0]], points[refs[1]], points[refs[2]])).toBeCloseTo(target, 10);
  expect(Math.hypot(...sub(points[3],points[refs[0]]))).toBeCloseTo(base.rows[3].values[0], 11);
 }
});
test('independent: impossible edits preserve the base and unsupported multi-frame or extended rows reject explicitly', () => {
 const base = geometryBase(xyz), original = structuredClone(base);
 expect(() => geometryText(base, withInternalCoordinate(base.rows, 3, 0, -1))).toThrow();
 expect(() => geometryText(base, withInternalCoordinate(base.rows, 3, 2, Number.POSITIVE_INFINITY))).toThrow();
 expect(base).toEqual(original);
 expect(() => geometryBase(xyz+xyz)).toThrow('multiple frames');
 expect(() => geometryBase(xyz.replace('H 3.4 3.6 1.8','H 3.4 3.6 1.8 0.2'))).toThrow('exactly an element');
 expect([clampInternalCoordinate('angle', -2), clampInternalCoordinate('angle', 185), clampInternalCoordinate('dihedral', 540), clampInternalCoordinate('dihedral', -540)]).toEqual([0,180,180,-180]);
});
