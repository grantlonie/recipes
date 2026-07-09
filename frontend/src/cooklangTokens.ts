import { normalizeUnit, splitGluedAmount } from './units'

export const INGREDIENT_TOKEN_RE =
  /@(?:([A-Za-z0-9_./' -]+?)\{([^}]*)\}|([A-Za-z0-9_./' -]+?)(?=\s|[.,;:!?)]|\(|$))(?:\(([^)]*)\))?/g

export interface IngredientAttrs {
  fixed: boolean
  name: string
  note: string
  quantity: string
  unit: string
}

export interface IngredientToken extends IngredientAttrs {
  amount: string
  end: number
  full: string
  start: number
}

export function formatIngredientLabel(name: string, note?: string | null): string {
  const trimmedNote = note?.trim()
  if (!trimmedNote) {
    return name
  }
  return `${name} (${trimmedNote})`
}

export function extractTokens(body: string): IngredientToken[] {
  const tokens: IngredientToken[] = []
  const pattern = new RegExp(INGREDIENT_TOKEN_RE.source, 'g')
  for (const match of body.matchAll(pattern)) {
    const full = match[0]
    const start = match.index ?? 0
    const bracedName = match[1]
    const amount = match[2]
    const bareName = match[3]
    const preparation = (match[4] ?? '').trim()
    const name = (bracedName || bareName || '').trim()
    if (!name) {
      continue
    }
    const { fixed, quantity, unit } = splitAmount(amount ?? '')
    tokens.push({
      amount: amount ?? '',
      end: start + full.length,
      fixed,
      full,
      name,
      note: preparation,
      quantity,
      start,
      unit,
    })
  }
  return tokens
}

export function splitAmount(amount: string) {
  const fixed = amount.startsWith('=')
  const value = fixed ? amount.slice(1) : amount
  if (value.includes('%')) {
    const [quantity, unit] = value.split('%', 2)
    const normalizedUnit = normalizeUnit(unit.trim())
    return {
      fixed,
      quantity: quantity.trim(),
      unit: normalizedUnit ?? unit.trim(),
    }
  }
  const match = value.trim().match(/^(\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)\s+(.+)$/)
  if (match) {
    const normalizedUnit = normalizeUnit(match[2].trim())
    return { fixed, quantity: match[1], unit: normalizedUnit ?? match[2].trim() }
  }
  const glued = splitGluedAmount(value)
  if (glued) {
    return { fixed, quantity: glued.quantity, unit: glued.unit }
  }
  return { fixed, quantity: value.trim(), unit: '' }
}

function buildIngredientCore(attrs: IngredientAttrs): string {
  const name = attrs.name.trim()
  const quantity = attrs.quantity.trim()
  const unit = attrs.unit.trim()
  if (!quantity) {
    return `@${name}`
  }
  if (!unit) {
    return `@${name}{${attrs.fixed ? '=' : ''}${quantity}}`
  }
  return `@${name}{${attrs.fixed ? '=' : ''}${quantity}%${unit}}`
}

export function serializeIngredient(attrs: IngredientAttrs): string {
  const core = buildIngredientCore(attrs)
  const note = attrs.note.trim()
  if (!note) {
    return core
  }
  return `${core}(${note})`
}

export function ingredientToPlainText(attrs: IngredientAttrs): string {
  const parts: string[] = []
  const quantity = attrs.quantity.trim()
  const unit = attrs.unit.trim()
  const name = attrs.name.trim()
  const note = attrs.note.trim()
  if (quantity) {
    parts.push(quantity)
  }
  if (unit) {
    parts.push(unit)
  }
  if (name) {
    parts.push(name)
  }
  let text = parts.join(' ')
  if (note) {
    text = text ? `${text} (${note})` : `(${note})`
  }
  return text
}
