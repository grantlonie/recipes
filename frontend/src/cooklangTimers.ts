import { COOKLANG_TOKEN_CHARS } from './cooklangTokens'
import { parseQuantity } from './quantities'
import { splitGluedAmount } from './units'

export const TIMER_TOKEN_RE = new RegExp(`~([${COOKLANG_TOKEN_CHARS}]*?)\\{([^}]*)\\}`, 'g')

export type TimerUnit = 'hours' | 'minutes'

export interface TimerAttrs {
  name: string
  quantity: string
  unit: string
}

export interface TimerToken extends TimerAttrs {
  end: number
  full: string
  start: number
}

export function extractTimerTokens(body: string): TimerToken[] {
  const tokens: TimerToken[] = []
  const pattern = new RegExp(TIMER_TOKEN_RE.source, 'g')
  for (const match of body.matchAll(pattern)) {
    const full = match[0]
    const start = match.index ?? 0
    const name = (match[1] ?? '').trim()
    const amount = match[2] ?? ''
    const { quantity, unit } = splitTimerAmount(amount)
    tokens.push({
      end: start + full.length,
      full,
      name,
      quantity,
      start,
      unit,
    })
  }
  return tokens
}

export function serializeTimer(attrs: TimerAttrs): string {
  const name = attrs.name.trim()
  const quantity = attrs.quantity.trim()
  const unit = normalizeTimerUnitForStorage(quantity, attrs.unit)
  const amount = unit ? `${quantity}%${unit}` : quantity
  return name ? `~${name}{${amount}}` : `~{${amount}}`
}

export function formatTimerLabel(attrs: TimerAttrs): string {
  const quantity = attrs.quantity.trim()
  if (quantity) {
    return `${quantity} ${abbreviateTimerUnit(attrs.unit, quantity)}`
  }
  const name = attrs.name.trim()
  if (name && name.toLowerCase() !== 'timer') {
    return name
  }
  return 'timer'
}

export function timerUnitSelectValue(unit: string): TimerUnit {
  const normalized = unit.trim().toLowerCase()
  if (
    normalized === 'hour' ||
    normalized === 'hours' ||
    normalized === 'hr' ||
    normalized === 'hrs'
  ) {
    return 'hours'
  }
  return 'minutes'
}

export function normalizeTimerUnitForStorage(quantity: string, unit: string): string {
  const select = timerUnitSelectValue(unit)
  if (select === 'hours') {
    return quantity.trim() === '1' ? 'hour' : 'hours'
  }
  return 'minutes'
}

export function timerAttrsToDurationMs(attrs: TimerAttrs): number | null {
  const quantity = parseQuantity(attrs.quantity)
  if (quantity == null || quantity <= 0) {
    return null
  }
  const unit = timerUnitSelectValue(attrs.unit)
  if (unit === 'hours') {
    return Math.round(quantity * 60 * 60 * 1000)
  }
  return Math.round(quantity * 60 * 1000)
}

function abbreviateTimerUnit(unit: string, quantity: string): string {
  if (timerUnitSelectValue(unit) === 'hours') {
    return quantity.trim() === '1' ? 'hour' : 'hours'
  }
  return 'min'
}

function splitTimerAmount(amount: string) {
  const fixed = amount.startsWith('=')
  const value = fixed ? amount.slice(1) : amount
  if (value.includes('%')) {
    const [quantity, unit] = value.split('%', 2)
    return {
      quantity: quantity.trim(),
      unit: unit.trim(),
    }
  }
  const match = value.trim().match(/^(\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)\s+(.+)$/)
  if (match) {
    return { quantity: match[1], unit: match[2].trim() }
  }
  const glued = splitGluedAmount(value)
  if (glued) {
    return { quantity: glued.quantity, unit: glued.unit }
  }
  return { quantity: value.trim(), unit: '' }
}
