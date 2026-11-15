import type { KeyboardEvent } from 'react'

const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const

// Arrow keys move focus to the nearest item on screen in that direction:
// along a row first, then by DOM order; up and down pick the nearest row and
// the item whose left edge is closest. Home and End go to the first and last item.
export function moveFocus(event: KeyboardEvent<HTMLElement>, selector = 'button:not(:disabled)') {
  const step = steps[event.key as keyof typeof steps]
  if (!step && event.key !== 'Home' && event.key !== 'End') return false
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)]
  const current = document.activeElement as HTMLElement | null
  const index = current ? items.indexOf(current) : -1
  if (!items.length || index < 0) return false
  let next: HTMLElement | undefined
  if (!step) next = event.key === 'Home' ? items[0] : items.at(-1)
  else {
    const [dx, dy] = step
    const from = current!.getBoundingClientRect()
    const cy = from.top + from.height / 2
    let best = Infinity
    for (const item of items) {
      if (item === current) continue
      const box = item.getBoundingClientRect()
      const y = box.top + box.height / 2 - cy
      if (dx) {
        const x = (box.left - from.left) * dx
        if (x <= 0 || Math.abs(y) > from.height / 2) continue
        if (x < best) [best, next] = [x, item]
      } else {
        const along = y * dy
        if (along <= from.height / 2) continue
        const score = along * 1000 + Math.abs(box.left - from.left)
        if (score < best) [best, next] = [score, item]
      }
    }
    if (!next && dx) next = items[index + dx]
  }
  event.preventDefault()
  event.stopPropagation()
  next?.focus()
  return true
}
