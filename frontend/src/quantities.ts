const UNICODE_FRACTION_VALUES: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
}

/** Cooking-friendly display fractions: quarters, thirds, and half. */
const DISPLAY_FRACTIONS: Array<{ label: string; value: number }> = [
  { label: '', value: 0 },
  { label: '¼', value: 0.25 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 0.5 },
  { label: '⅔', value: 2 / 3 },
  { label: '¾', value: 0.75 },
  { label: '', value: 1 },
]

export const FRACTION_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '—', value: 0 },
  { label: '¼', value: 0.25 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 0.5 },
  { label: '⅔', value: 2 / 3 },
  { label: '¾', value: 0.75 },
]

export interface QuantityParts {
  fraction: number
  whole: number
}

export function quantityToParts(value: string): QuantityParts {
  const parsed = parseQuantity(value)
  if (parsed === null) {
    return { fraction: 0, whole: 0 }
  }

  const nearest = nearestDisplayAmount(parsed)
  return {
    fraction: nearest.fraction,
    whole: nearest.whole,
  }
}

export function partsToQuantity(whole: number, fraction: number): string {
  if (whole === 0 && fraction === 0) {
    return ''
  }

  if (fraction === 0) {
    return String(whole)
  }

  const label = DISPLAY_FRACTIONS.find(
    option => option.value !== 0 && option.value !== 1 && almostEqual(option.value, fraction)
  )?.label
  const fractionLabel = label ?? String(fraction)
  if (whole === 0) {
    return fractionLabel
  }
  return `${whole} ${fractionLabel}`
}

export function parseQuantity(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed in UNICODE_FRACTION_VALUES) {
    return UNICODE_FRACTION_VALUES[trimmed]
  }

  for (const [character, fraction] of Object.entries(UNICODE_FRACTION_VALUES)) {
    if (!trimmed.includes(character)) {
      continue
    }
    const [whole, remainder] = trimmed.split(character, 2)
    if (remainder.trim()) {
      continue
    }
    const wholeNumber = whole.trim() ? Number(whole.trim()) : 0
    if (!Number.isNaN(wholeNumber)) {
      return wholeNumber + fraction
    }
  }

  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixedMatch) {
    return Number(mixedMatch[1]) + Number(mixedMatch[2]) / Number(mixedMatch[3])
  }

  const fractionMatch = trimmed.match(/^(\d+)\/(\d+)$/)
  if (fractionMatch) {
    return Number(fractionMatch[1]) / Number(fractionMatch[2])
  }

  const decimal = Number(trimmed)
  if (!Number.isNaN(decimal)) {
    return decimal
  }

  return null
}

export function formatQuantityDisplay(value: string): string {
  const parsed = parseQuantity(value)
  if (parsed === null) {
    return value
  }

  const nearest = nearestDisplayAmount(parsed)
  if (nearest.fraction === 0) {
    return String(nearest.whole)
  }

  const label = DISPLAY_FRACTIONS.find(
    option => option.value !== 0 && option.value !== 1 && almostEqual(option.value, nearest.fraction)
  )?.label
  const fractionLabel = label ?? String(nearest.fraction)
  if (nearest.whole === 0) {
    return fractionLabel
  }
  return `${nearest.whole} ${fractionLabel}`
}

function nearestDisplayAmount(value: number): QuantityParts {
  const absolute = Math.abs(value)
  const whole = Math.floor(absolute + 1e-9)
  const frac = absolute - whole

  let best = DISPLAY_FRACTIONS[0]
  let bestDistance = Number.POSITIVE_INFINITY
  let bestTieBreak = Number.POSITIVE_INFINITY
  for (const candidate of DISPLAY_FRACTIONS) {
    const distance = Math.abs(candidate.value - frac)
    const tieBreak = candidate.value === 0 || candidate.value === 1 ? 1 : 0
    if (
      distance < bestDistance - 1e-12 ||
      (Math.abs(distance - bestDistance) <= 1e-12 && tieBreak < bestTieBreak)
    ) {
      best = candidate
      bestDistance = distance
      bestTieBreak = tieBreak
    }
  }

  if (best.value === 1) {
    return { fraction: 0, whole: whole + 1 }
  }
  return { fraction: best.value, whole }
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9
}
