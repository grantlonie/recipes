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

const EIGHTH_UNICODE: Record<number, string> = {
  1: '⅛',
  2: '¼',
  3: '⅜',
  4: '½',
  5: '⅝',
  6: '¾',
  7: '⅞',
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

  const eighths = Math.round(parsed * 8)
  const whole = Math.floor(eighths / 8)
  const remainderEighths = ((eighths % 8) + 8) % 8

  if (remainderEighths === 0) {
    return String(whole)
  }

  const fraction = EIGHTH_UNICODE[remainderEighths] ?? `${remainderEighths}/8`
  if (whole === 0) {
    return fraction
  }
  return `${whole} ${fraction}`
}
