export type DisplayFormat = {
  alwaysShowSign: boolean
}

export type ResolveActiveStepOptions = {
  step: number
  shiftStep: number
  fineStep: number
  coarse?: boolean
  fine?: boolean
}

export type ModifierKey = "shift" | "alt" | "meta"

export type FineModifier = "shift" | "alt" | "meta"

export type CoarseModifier = "shift" | "alt" | "meta"

const FINE_MODIFIER_KEYS = new Set<FineModifier>(["shift", "alt", "meta"])
const COARSE_MODIFIER_KEYS = new Set<CoarseModifier>(["shift", "alt", "meta"])

export type ModifierKeys = {
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  getModifierState?: (key: string) => boolean
}

const DEFAULT_SCRUB_THRESHOLD = 3

export function isMacPlatform() {
  if (typeof navigator === "undefined") {
    return false
  }

  const platform = navigator.platform ?? ""
  const userAgent = navigator.userAgent ?? ""

  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(userAgent)
}

export function isModifierKeyPressed(event: ModifierKeys, key: ModifierKey) {
  const getState = event.getModifierState?.bind(event)

  switch (key) {
    case "shift":
      return event.shiftKey || getState?.("Shift") === true
    case "alt":
      return event.altKey || getState?.("Alt") === true
    case "meta":
      return event.metaKey || getState?.("Meta") === true
  }
}

export function normalizeFineModifier(
  modifier: string | undefined,
  fallback: FineModifier = "alt",
): FineModifier {
  if (modifier != null && FINE_MODIFIER_KEYS.has(modifier as FineModifier)) {
    return modifier as FineModifier
  }

  if (modifier === "auto") {
    return isMacPlatform() ? "meta" : "alt"
  }

  return fallback
}

export function normalizeCoarseModifier(
  modifier: string | undefined,
  fallback: CoarseModifier = "shift",
): CoarseModifier {
  if (modifier != null && COARSE_MODIFIER_KEYS.has(modifier as CoarseModifier)) {
    return modifier as CoarseModifier
  }

  if (modifier === "auto") {
    return "shift"
  }

  return fallback
}

export const MODIFIER_OPTIONS = ["shift", "alt", "meta"] as const satisfies readonly ModifierKey[]

export function pickAlternateModifier(
  current: ModifierKey,
  exclude: ModifierKey,
): ModifierKey {
  return MODIFIER_OPTIONS.find((option) => option !== exclude) ?? current
}

export function resolveExclusiveModifiers(
  fine: FineModifier,
  coarse: CoarseModifier,
): { fine: FineModifier; coarse: CoarseModifier } {
  if (fine !== coarse) {
    return { fine, coarse }
  }

  return {
    fine,
    coarse: pickAlternateModifier(coarse, fine) as CoarseModifier,
  }
}

export function resolveFineModifierKey(
  modifier: FineModifier = "alt",
): ModifierKey {
  return modifier
}

export function resolveCoarseModifierKey(
  modifier: CoarseModifier = "shift",
): ModifierKey {
  return modifier
}

export function isFineModifierPressed(
  event: ModifierKeys,
  modifier: FineModifier = "alt",
) {
  return isModifierKeyPressed(event, resolveFineModifierKey(modifier))
}

export function isCoarseModifierPressed(
  event: ModifierKeys,
  modifier: CoarseModifier = "shift",
) {
  return isModifierKeyPressed(event, resolveCoarseModifierKey(modifier))
}

export function getModifierLabel(key: ModifierKey) {
  switch (key) {
    case "shift":
      return "Shift"
    case "alt":
      return "Alt"
    case "meta":
      return "Cmd"
  }
}

export function getFineModifierLabel(modifier: FineModifier = "alt") {
  return getModifierLabel(resolveFineModifierKey(modifier))
}

export function getCoarseModifierLabel(modifier: CoarseModifier = "shift") {
  return getModifierLabel(resolveCoarseModifierKey(modifier))
}

export type ScrubStepModifiers = {
  coarse: boolean
  fine: boolean
}

export function toModifierKeys(event: {
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  getModifierState?: (key: string) => boolean
}): ModifierKeys {
  return {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    getModifierState: event.getModifierState
      ? (key) => event.getModifierState!(key)
      : undefined,
  }
}

export function resolveScrubStepModifiers(
  event: ModifierKeys,
  options: {
    fineModifier?: FineModifier
    coarseModifier?: CoarseModifier
  } = {},
): ScrubStepModifiers {
  const coarse = isCoarseModifierPressed(event, options.coarseModifier)
  const fine = isFineModifierPressed(event, options.fineModifier)

  return { coarse, fine }
}

export function clampNumber(value: number, min?: number, max?: number) {
  let bounded = value

  if (min != null && Number.isFinite(min)) {
    bounded = Math.max(min, bounded)
  }

  if (max != null && Number.isFinite(max)) {
    bounded = Math.min(max, bounded)
  }

  return bounded
}

export function normalizeFiniteNumber(
  value: number | undefined,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function normalizeNumberFieldBounds(
  min?: number,
  max?: number,
): { min?: number; max?: number } {
  let normalizedMin = normalizeFiniteNumber(min)
  let normalizedMax = normalizeFiniteNumber(max)

  if (
    normalizedMin != null &&
    normalizedMax != null &&
    normalizedMin > normalizedMax
  ) {
    ;[normalizedMin, normalizedMax] = [normalizedMax, normalizedMin]
  }

  return { min: normalizedMin, max: normalizedMax }
}

export function normalizePositiveFiniteStep(
  step: number | undefined,
  fallback = 1,
) {
  if (
    typeof step === "number" &&
    Number.isFinite(step) &&
    step > 0
  ) {
    return step
  }

  return fallback
}

export function normalizeWheelSensitivity(
  sensitivity: number | undefined,
  fallback = 20,
) {
  return clampNumber(
    normalizePositiveFiniteStep(sensitivity, fallback),
    1,
    200,
  )
}

export function normalizeScrubThreshold(threshold: number | undefined, fallback = 3) {
  const candidate =
    typeof threshold === "number" && Number.isFinite(threshold)
      ? threshold
      : fallback

  return clampNumber(candidate, 1, 20)
}

export function getBoundEdge(
  current: number,
  attempted: number,
  min?: number,
  max?: number,
): "min" | "max" | null {
  if (attempted > current && max != null && current >= max) {
    return "max"
  }

  if (attempted < current && min != null && current <= min) {
    return "min"
  }

  return null
}

export function getAtBound(
  value: number,
  min?: number,
  max?: number,
): "min" | "max" | null {
  if (max != null && value >= max) {
    return "max"
  }

  if (min != null && value <= min) {
    return "min"
  }

  return null
}

export function boundOverflow(
  attempted: number,
  edge: "min" | "max",
  min?: number,
  max?: number,
) {
  if (edge === "max" && max != null) {
    return Math.max(0, attempted - max)
  }

  if (edge === "min" && min != null) {
    return Math.max(0, min - attempted)
  }

  return 1
}

export function quantizeNumber(value: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) {
    return value
  }

  const quantized = Math.round(value / step) * step

  if (Number.isInteger(step)) {
    return quantized
  }

  const decimals = step.toString().split(".")[1]?.length ?? 0
  return parseFloat(quantized.toFixed(decimals))
}

export function getDecimalPlaces(step: number) {
  if (!Number.isFinite(step) || Number.isInteger(step)) {
    return 0
  }

  return step.toString().split(".")[1]?.length ?? 0
}

function toPlainNumberString(value: number) {
  if (!Number.isFinite(value)) {
    return String(value)
  }

  if (Object.is(value, -0)) {
    return "0"
  }

  const str = value.toString()

  if (!/[eE]/.test(str)) {
    return str
  }

  return value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 100,
  })
}

export function formatMinimalDisplayValue(value: number) {
  const normalized = Number(value.toPrecision(12))

  if (Number.isInteger(normalized)) {
    return toPlainNumberString(Math.trunc(normalized))
  }

  return toPlainNumberString(normalized)
}

export function countDraftDecimalPlaces(draft: string) {
  const body = draft.trim().replace(/^[+-]/, "")

  if (!body.includes(".")) {
    return 0
  }

  return body.split(".")[1]?.length ?? 0
}

export function resolveDisplayDecimalPlaces(
  previousDraft: string,
  userDecimalPlaces?: number | null,
  activeStep?: number,
) {
  if (userDecimalPlaces != null && userDecimalPlaces > 0) {
    return userDecimalPlaces
  }

  const fromDraft = countDraftDecimalPlaces(previousDraft)

  if (fromDraft > 0) {
    return fromDraft
  }

  const fromStep = activeStep != null ? getDecimalPlaces(activeStep) : 0

  return fromStep > 0 ? fromStep : null
}

export function formatDisplayValue(
  value: number,
  format: Pick<DisplayFormat, "alwaysShowSign">,
  userDecimalPlaces: number | null = null,
) {
  const formatted =
    userDecimalPlaces != null && userDecimalPlaces > 0
      ? value.toFixed(userDecimalPlaces)
      : formatMinimalDisplayValue(value)

  if (format.alwaysShowSign && value > 0) {
    return `+${formatted}`
  }

  return formatted
}

export function resolveActiveStep(options: ResolveActiveStepOptions) {
  const { step, shiftStep, fineStep, coarse = false, fine = false } = options

  if (coarse) {
    return shiftStep
  }

  if (fine) {
    return fineStep
  }

  return step
}

const DEFAULT_WHEEL_LINE_DELTA = 16
const DEFAULT_WHEEL_PAGE_DELTA = 100

export function normalizeWheelDelta(deltaY: number, deltaMode = 0) {
  switch (deltaMode) {
    case 1:
      return deltaY * DEFAULT_WHEEL_LINE_DELTA
    case 2:
      return deltaY * DEFAULT_WHEEL_PAGE_DELTA
    default:
      return deltaY
  }
}

export type ConsumeWheelDeltaResult = {
  accumulated: number
  direction: 0 | 1 | -1
  steps: number
}

export function consumeWheelDelta(
  accumulated: number,
  deltaY: number,
  sensitivity: number,
): ConsumeWheelDeltaResult {
  const next = accumulated + deltaY
  const abs = Math.abs(next)
  const threshold = Math.max(1, sensitivity)

  if (abs < threshold) {
    return { accumulated: next, steps: 0, direction: 0 }
  }

  const steps = Math.floor(abs / threshold)
  const sign = next < 0 ? -1 : 1
  const remainder = next - sign * steps * threshold
  const direction = (next < 0 ? 1 : -1) as 1 | -1

  return { accumulated: remainder, steps, direction }
}

export function getValueDecimalPlaces(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  const normalized = Number(value.toPrecision(12))

  if (Number.isInteger(normalized)) {
    return 0
  }

  const text = normalized.toString()

  if (text.includes("e") || text.includes("E")) {
    return getValueDecimalPlaces(Number(normalized.toFixed(12)))
  }

  return text.split(".")[1]?.length ?? 0
}

export function stepFromDecimalPlaces(decimals: number) {
  if (decimals <= 0) {
    return 1
  }

  return Number((1 / 10 ** decimals).toFixed(decimals))
}

export function resolveQuantizeStep(options: {
  step: number
  fineStep: number
  fine?: boolean
  currentValue: number
  userDecimalPlaces?: number | null
}) {
  const activeStep = options.fine ? options.fineStep : options.step
  const valuePrecision = Math.max(
    getValueDecimalPlaces(options.currentValue),
    options.userDecimalPlaces ?? 0,
  )
  const stepPrecision = getDecimalPlaces(activeStep)

  if (valuePrecision > stepPrecision) {
    return stepFromDecimalPlaces(valuePrecision)
  }

  return activeStep
}

export function applyStepDelta(
  current: number,
  delta: number,
  options: {
    step: number
    fineStep: number
    fine?: boolean
    userDecimalPlaces?: number | null
  },
) {
  const next = current + delta

  if (options.userDecimalPlaces != null && options.userDecimalPlaces > 0) {
    return parseFloat(next.toFixed(options.userDecimalPlaces))
  }

  const quantizeStep = resolveQuantizeStep({
    step: options.step,
    fineStep: options.fineStep,
    fine: options.fine,
    currentValue: current,
    userDecimalPlaces: options.userDecimalPlaces,
  })

  return quantizeNumber(next, quantizeStep)
}

export function preserveDisplayDraft(
  currentDraft: string,
  value: number,
  fallback: string,
) {
  const parsed = Number(currentDraft.replace(/^\+/, ""))

  if (currentDraft !== "" && Number.isFinite(parsed) && parsed === value) {
    return currentDraft
  }

  return fallback
}

export function getScrubPointerDelta(
  event: { clientX: number; clientY: number },
  startX: number,
  startY: number,
  direction: "horizontal" | "vertical",
) {
  if (direction === "vertical") {
    return startY - event.clientY
  }

  return event.clientX - startX
}

export function hasExceededScrubThreshold(
  event: { clientX: number; clientY: number },
  startX: number,
  startY: number,
  direction: "horizontal" | "vertical",
  threshold = DEFAULT_SCRUB_THRESHOLD,
) {
  const effectiveThreshold = Math.max(1, threshold)

  if (direction === "vertical") {
    return Math.abs(event.clientY - startY) > effectiveThreshold
  }

  return Math.abs(event.clientX - startX) > effectiveThreshold
}

export function resolveFineStep(step: number, fineStep?: number) {
  if (fineStep != null && Number.isFinite(fineStep) && fineStep > 0) {
    return fineStep
  }

  return quantizeNumber(step / 10, step) || step / 10
}

export function sanitizeNumericDraft(value: string, previousValue = "") {
  if (value === "") {
    return ""
  }

  if (/^[+-]{2,}/.test(value)) {
    return previousValue
  }

  if (/[eE]/.test(value) || (value.match(/\./g)?.length ?? 0) > 1) {
    return previousValue
  }

  let sign = ""
  let rest = value

  if (rest.startsWith("+") || rest.startsWith("-")) {
    sign = rest[0]
    rest = rest.slice(1)
  }

  let hasDot = false
  let body = ""

  for (const character of rest) {
    if (character >= "0" && character <= "9") {
      body += character
      continue
    }

    if (character === "." && !hasDot) {
      hasDot = true
      body += character
    }
  }

  const sanitized = sign + body

  return sanitized
}
