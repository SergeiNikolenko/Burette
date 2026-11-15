import type { ReactNode } from 'react'

// Chemistry glyphs on the lucide grid: 24 viewBox, current color, round caps.
function Glyph({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

type Point = [number, number]
const fmt = (value: number) => Number(value.toFixed(2))
const line = ([x1, y1]: Point, [x2, y2]: Point) => `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`

// Bond glyphs run diagonally from the lower left; hashes widen toward the far end.
const hashes = Array.from({ length: 5 }, (_, index) => {
  const t = 0.1 + index * 0.21
  const half = (0.6 + index * 0.6) / Math.SQRT2
  const [x, y] = [5 + 14 * t, 19 - 14 * t]
  return line([x - half, y - half], [x + half, y + half])
}).join('')

const bondPaths = {
  single: <path d="M5.5 18.5 18.5 5.5" />,
  double: <path d="M4.5 16.5 16.5 4.5M7.5 19.5 19.5 7.5" />,
  triple: <path d="M6.5 17.5 17.5 6.5M4.2 15.2 15.2 4.2M8.8 19.8 19.8 8.8" />,
  wedge: <path d="M5 19 16.7 3.9 20.1 7.3Z" fill="currentColor" />,
  hash: <path d={hashes} />,
  wavy: <path d="M3 12c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0" transform="rotate(-45 12 12)" />,
}
export type BondType = keyof typeof bondPaths

export const BondIcon = ({ type }: { type: BondType }) => <Glyph>{bondPaths[type]}</Glyph>

export const ChainIcon = () => <Glyph><path d="M3 15.5 7.5 8.5l4.5 7 4.5-7 4.5 7" /></Glyph>

// Regular polygons centered on the grid, with Kekulé double bonds drawn inside.
function ringPaths(size: number, doubles: number[] = []) {
  const radius = size === 3 ? 9.5 : 8.5
  const start = size === 4 || size === 8 ? Math.PI / size : 0
  const shift = size % 2 ? radius * (1 - Math.cos(Math.PI / size)) / 2 : 0
  const points = Array.from({ length: size }, (_, index): Point => {
    const angle = start + 2 * Math.PI * index / size
    return [12 + radius * Math.sin(angle), 12 + shift - radius * Math.cos(angle)]
  })
  const outline = `M${points.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`
  const inner = doubles.map(edge => {
    const [a, b] = [points[edge], points[(edge + 1) % size]]
    const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const distance = Math.hypot(12 - mx, 12 + shift - my)
    const [ox, oy] = [(12 - mx) / distance * 2.6, (12 + shift - my) / distance * 2.6]
    const [dx, dy] = [(b[0] - a[0]) * 0.2, (b[1] - a[1]) * 0.2]
    return line([a[0] + dx + ox, a[1] + dy + oy], [b[0] - dx + ox, b[1] - dy + oy])
  }).join('')
  return outline + inner
}

export const rings = {
  benzene: ringPaths(6, [0, 2, 4]),
  cyclopentadiene: ringPaths(5, [1, 3]),
  cyclohexane: ringPaths(6),
  cyclopentane: ringPaths(5),
  cyclopropane: ringPaths(3),
  cyclobutane: ringPaths(4),
  cycloheptane: ringPaths(7),
  cyclooctane: ringPaths(8),
}
export type Ring = keyof typeof rings

export const RingIcon = ({ ring }: { ring: Ring }) => <Glyph><path d={rings[ring]} /></Glyph>

const hexagon = ringPaths(6)

export const AromaticIcon = () => <Glyph><path d={hexagon} /><circle cx="12" cy="12" r="4.25" /></Glyph>

export const ChargeIcon = ({ sign }: { sign: 'plus' | 'minus' }) => <Glyph>
  <circle cx="12" cy="12" r="8.5" /><path d={sign === 'plus' ? 'M12 8.5v7M8.5 12h7' : 'M8.5 12h7'} />
</Glyph>

export const RGroupIcon = () => <Glyph><path d="M8 19V5h5a4 4 0 0 1 0 8H8m4.5 0L17 19" /></Glyph>

// A bond ending in the wavy line that marks an attachment point.
export const AttachIcon = () => <Glyph>
  <path d="M4.5 19.5 12 12" />
  <path d="M5 12c1.17-2.33 2.33-2.33 3.5 0s2.33 2.33 3.5 0 2.33-2.33 3.5 0 2.33 2.33 3.5 0" transform="rotate(45 12 12)" />
</Glyph>

// Repeat-unit brackets crossing a bond, with the "n" subscript.
export const PolymerIcon = () => <Glyph>
  <path d="M7 4.5H4.5v15H7M14 4.5h2.5v15H14M2 12h17" />
  <path d="M19 17v4m0-2.5a1.5 1.5 0 0 1 3 0V21" />
</Glyph>

// Periodic table silhouette with the f-block row below.
export const ElementsIcon = () => <Glyph><path d="M3 4.5h3.5v4h11v-4H21V16H3ZM7 19.5h10" /></Glyph>

export const HydrogensIcon = () => <Glyph><path d="M8 4.5H5.5v15H8M16 4.5h2.5v15H16M10 8.5v7m4-7v7m-4-3.5h4" /></Glyph>

export const StereoIcon = () => <Glyph>
  <path d="M8 4.5c-2.3 2-3.5 4.5-3.5 7.5s1.2 5.5 3.5 7.5M16 4.5c2.3 2 3.5 4.5 3.5 7.5s-1.2 5.5-3.5 7.5M10 16V8h2.5a2.3 2.3 0 0 1 0 4.6H10m2.4 0 2 3.4" />
</Glyph>

const smallHexagon = 'M10 7.5l4.76 2.75v5.5L10 18.5l-4.76-2.75v-5.5Z'

export const LayoutIcon = () => <Glyph><path d={smallHexagon} /><path d="M14 3.5a6.5 6.5 0 0 1 6.5 6.5m0 0 1.6-2.2m-1.6 2.2-2.4-1.3" /></Glyph>

export const CleanIcon = () => <Glyph><path d={smallHexagon} /><path d="M18 2.75c.35 1.75 1 2.4 2.75 2.75-1.75.35-2.4 1-2.75 2.75-.35-1.75-1-2.4-2.75-2.75 1.75-.35 2.4-1 2.75-2.75Z" /></Glyph>
