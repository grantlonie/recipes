import { formatQuantityDisplay, parseQuantity } from './quantities'
import type { CatalogIngredient, UnitSystem } from './types'

export const ML_PER_CUP = 236.5882365
export const ML_PER_TBSP = ML_PER_CUP / 16
export const ML_PER_TSP = ML_PER_CUP / 48
export const ML_PER_QUART = ML_PER_CUP * 4
export const ML_PER_PINT = ML_PER_CUP * 2
export const ML_PER_GALLON = ML_PER_CUP * 16
export const G_PER_OZ = 28.349523125
export const G_PER_LB = 453.59237

const UNIT_ALIASES: Record<string, string> = {
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  cup: 'cup',
  cups: 'cup',
  c: 'cup',
  tbsp: 'Tbsp',
  tbs: 'Tbsp',
  tablespoon: 'Tbsp',
  tablespoons: 'Tbsp',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  quart: 'quart',
  quarts: 'quart',
  qt: 'quart',
  pint: 'pint',
  pints: 'pint',
  pt: 'pint',
  gallon: 'gallon',
  gallons: 'gallon',
  gal: 'gallon',
}

const MASS_TO_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: G_PER_OZ,
  lb: G_PER_LB,
}

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  cup: ML_PER_CUP,
  Tbsp: ML_PER_TBSP,
  tsp: ML_PER_TSP,
  quart: ML_PER_QUART,
  pint: ML_PER_PINT,
  gallon: ML_PER_GALLON,
}

export interface DisplayAmount {
  quantity: string
  unit: string | null
}

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) {
    return null
  }
  const key = unit.trim().toLowerCase()
  if (!key) {
    return null
  }
  return UNIT_ALIASES[key] ?? unit.trim()
}

export function splitGluedAmount(value: string): { quantity: string; unit: string } | null {
  const stripped = value.trim()
  if (!stripped) {
    return null
  }
  for (const alias of Object.keys(UNIT_ALIASES).sort((left, right) => right.length - left.length)) {
    if (stripped.length <= alias.length) {
      continue
    }
    if (stripped.toLowerCase().endsWith(alias.toLowerCase())) {
      const quantity = stripped.slice(0, -alias.length).trim()
      if (parseQuantity(quantity) !== null) {
        const unit = normalizeUnit(alias)
        if (unit) {
          return { quantity, unit }
        }
      }
    }
  }
  return null
}

export function isMassUnit(unit: string | null | undefined): boolean {
  const canonical = normalizeUnit(unit)
  return canonical !== null && canonical in MASS_TO_GRAMS
}

export function isVolumeUnit(unit: string | null | undefined): boolean {
  const canonical = normalizeUnit(unit)
  return canonical !== null && canonical in VOLUME_TO_ML
}

const US_COOKING_VOLUME_UNITS = new Set(['cup', 'Tbsp', 'tsp'])

export function isUsCookingVolumeUnit(unit: string | null | undefined): boolean {
  const canonical = normalizeUnit(unit)
  return canonical !== null && US_COOKING_VOLUME_UNITS.has(canonical)
}

export function toGrams(
  quantity: number,
  unit: string | null | undefined,
  densityKgM3?: number | null
): number | null {
  const canonical = normalizeUnit(unit)
  if (!canonical) {
    return null
  }
  if (canonical in MASS_TO_GRAMS) {
    return quantity * MASS_TO_GRAMS[canonical]
  }
  if (canonical in VOLUME_TO_ML) {
    if (densityKgM3 == null || densityKgM3 <= 0) {
      return null
    }
    const ml = quantity * VOLUME_TO_ML[canonical]
    return (ml * densityKgM3) / 1000
  }
  return null
}

export function formatGramsValue(grams: number): string {
  return formatStoredGrams(grams)
}

function formatStoredGrams(grams: number): string {
  const sign = grams < 0 ? '-' : ''
  const value = Math.abs(grams)
  if (value <= 20) {
    const rounded = Math.round(value * 10) / 10
    return sign + trimNumber(rounded, 1)
  }
  return sign + String(Math.round(value))
}

function formatMetricMass(grams: number): DisplayAmount {
  const sign = grams < 0 ? '-' : ''
  const value = Math.abs(grams)
  if (value >= 2000) {
    const wholeGrams = Math.round(value)
    const kg = wholeGrams / 1000
    if (Math.abs(kg - Math.round(kg)) < 0.05) {
      return { quantity: sign + String(Math.round(kg)), unit: 'kg' }
    }
    return { quantity: sign + trimNumber(kg, 1), unit: 'kg' }
  }
  if (value <= 20) {
    const rounded = Math.round(value * 10) / 10
    return { quantity: sign + trimNumber(rounded, 1), unit: 'g' }
  }
  return { quantity: sign + String(Math.round(value)), unit: 'g' }
}

function formatUsMass(grams: number): DisplayAmount {
  if (grams >= G_PER_LB) {
    return { quantity: formatQuantityDisplay(String(grams / G_PER_LB)), unit: 'lb' }
  }
  return { quantity: formatQuantityDisplay(String(grams / G_PER_OZ)), unit: 'oz' }
}

function formatUsVolume(grams: number, densityKgM3: number): DisplayAmount {
  const ml = (grams * 1000) / densityKgM3
  const cups = ml / ML_PER_CUP
  if (cups >= 4) {
    const quarts = cups / 4
    return {
      quantity: formatQuantityDisplay(String(quarts)),
      unit: quarts <= 1.01 ? 'quart' : 'quarts',
    }
  }
  if (cups >= 0.25) {
    return {
      quantity: formatQuantityDisplay(String(cups)),
      unit: cups <= 1.01 ? 'cup' : 'cups',
    }
  }
  const tbsp = ml / ML_PER_TBSP
  if (tbsp >= 1) {
    return { quantity: formatQuantityDisplay(String(tbsp)), unit: 'Tbsp' }
  }
  const tsp = ml / ML_PER_TSP
  return { quantity: formatQuantityDisplay(String(tsp)), unit: 'tsp' }
}

export function formatAmount(
  quantity: number | null,
  unit: string | null | undefined,
  options: { unitSystem: UnitSystem; densityKgM3?: number | null }
): DisplayAmount {
  if (quantity === null) {
    return { quantity: '', unit: normalizeUnit(unit) }
  }

  const canonical = normalizeUnit(unit)
  if (canonical === 'g') {
    if (options.unitSystem === 'us_weight') {
      return formatUsMass(quantity)
    }
    if (options.unitSystem === 'us') {
      if (options.densityKgM3 != null && options.densityKgM3 > 0) {
        return formatUsVolume(quantity, options.densityKgM3)
      }
      return formatUsMass(quantity)
    }
    return formatMetricMass(quantity)
  }

  return {
    quantity: formatQuantityDisplay(String(quantity)),
    unit: canonical ?? unit ?? null,
  }
}

export function formatDisplayAmount(amount: DisplayAmount): string {
  if (!amount.quantity) {
    return amount.unit ?? ''
  }
  if (!amount.unit) {
    return amount.quantity
  }
  return `${amount.quantity} ${amount.unit}`
}

export function formatIngredientAmount(
  quantityText: string | null | undefined,
  unit: string | null | undefined,
  options: {
    unitSystem: UnitSystem
    densityKgM3?: number | null
  }
): DisplayAmount {
  if (!quantityText) {
    return { quantity: '', unit: normalizeUnit(unit) }
  }
  const quantity = parseQuantity(quantityText)
  if (quantity === null) {
    return { quantity: formatQuantityDisplay(quantityText), unit: normalizeUnit(unit) }
  }
  return formatAmount(quantity, unit, options)
}

export function normalizeIngredientKey(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ')
}

const UNINFLECTED = new Set([
  'asparagus',
  'bass',
  'couscous',
  'hummus',
  'molasses',
  'news',
  'rice',
  'series',
  'species',
])

const IRREGULAR_PLURALS: Record<string, string> = {
  leaf: 'leaves',
  loaf: 'loaves',
  potato: 'potatoes',
  tomato: 'tomatoes',
  knife: 'knives',
  life: 'lives',
  wolf: 'wolves',
  calf: 'calves',
  self: 'selves',
  half: 'halves',
  elf: 'elves',
  thief: 'thieves',
}

const IRREGULAR_SINGULARS = Object.fromEntries(
  Object.entries(IRREGULAR_PLURALS).map(([singular, plural]) => [plural, singular])
)

function singularizeToken(token: string): string {
  const value = token.toLowerCase()
  if (!value || UNINFLECTED.has(value)) {
    return value
  }
  if (IRREGULAR_SINGULARS[value]) {
    return IRREGULAR_SINGULARS[value]
  }
  if (value.endsWith('ies') && value.length > 4) {
    return `${value.slice(0, -3)}y`
  }
  if (
    (value.endsWith('ches') ||
      value.endsWith('shes') ||
      value.endsWith('xes') ||
      value.endsWith('zes')) &&
    value.length > 4
  ) {
    return value.slice(0, -2)
  }
  if (value.endsWith('oes') && value.length > 4) {
    return value.slice(0, -2)
  }
  if (value.endsWith('ves') && value.length > 4) {
    return `${value.slice(0, -3)}f`
  }
  if (value.endsWith('s') && !value.endsWith('ss') && !value.endsWith('us') && !value.endsWith('is') && value.length > 3) {
    return value.slice(0, -1)
  }
  return value
}

function pluralizeToken(token: string): string {
  const value = token.toLowerCase()
  if (!value || UNINFLECTED.has(value)) {
    return value
  }
  if (IRREGULAR_PLURALS[value]) {
    return IRREGULAR_PLURALS[value]
  }
  if (value.endsWith('y') && value.length > 1 && !'aeiou'.includes(value[value.length - 2] ?? '')) {
    return `${value.slice(0, -1)}ies`
  }
  if (
    value.endsWith('s') ||
    value.endsWith('x') ||
    value.endsWith('z') ||
    value.endsWith('ch') ||
    value.endsWith('sh')
  ) {
    return `${value}es`
  }
  if (value.endsWith('f')) {
    return `${value.slice(0, -1)}ves`
  }
  if (value.endsWith('fe')) {
    return `${value.slice(0, -2)}ves`
  }
  if (!value.endsWith('s')) {
    return `${value}s`
  }
  return value
}

export function inflectionForms(value: string): string[] {
  const key = normalizeIngredientKey(value)
  if (!key) {
    return []
  }
  const parts = key.split(' ')
  const last = parts[parts.length - 1] ?? ''
  const variants = new Set<string>([key])
  for (const token of new Set([last, singularizeToken(last), pluralizeToken(last)])) {
    if (!token) {
      continue
    }
    variants.add(parts.length > 1 ? [...parts.slice(0, -1), token].join(' ') : token)
  }
  return [...variants]
}

export function findCatalogIngredient(
  name: string,
  catalog: CatalogIngredient[]
): CatalogIngredient | undefined {
  const importedForms = new Set(inflectionForms(name))
  return catalog.find(item => {
    const labelForms = new Set(
      [item.name, ...item.aliases].flatMap(label => inflectionForms(label))
    )
    for (const form of importedForms) {
      if (labelForms.has(form)) {
        return true
      }
    }
    return false
  })
}

export function ingredientKnowsName(ingredient: CatalogIngredient, name: string): boolean {
  const importedForms = new Set(inflectionForms(name))
  const labelForms = new Set(
    [ingredient.name, ...ingredient.aliases].flatMap(label => inflectionForms(label))
  )
  for (const form of importedForms) {
    if (labelForms.has(form)) {
      return true
    }
  }
  return false
}

export function withLearnedAlias(
  ingredient: CatalogIngredient,
  alias: string
): CatalogIngredient | null {
  const trimmed = alias.trim()
  if (!trimmed || ingredientKnowsName(ingredient, trimmed)) {
    return null
  }
  return {
    ...ingredient,
    aliases: [...ingredient.aliases, trimmed],
  }
}

export interface CatalogMatch {
  catalog?: CatalogIngredient
  note: string
}

export function matchCatalogIngredient(
  importedName: string,
  catalog: CatalogIngredient[]
): CatalogMatch {
  const trimmed = importedName.trim()
  if (!trimmed) {
    return { note: '' }
  }

  const exact = findCatalogIngredient(trimmed, catalog)
  if (exact) {
    return { catalog: exact, note: '' }
  }

  let best:
    | { item: CatalogIngredient; label: string; matchedForm: string; score: [number, number, number] }
    | undefined
  for (const item of catalog) {
    for (const label of [item.name, ...item.aliases]) {
      const candidate = label.trim()
      if (!candidate) {
        continue
      }
      const matchedForm = matchedPhraseForm(trimmed, candidate)
      if (!matchedForm) {
        continue
      }
      const score = phraseMatchScore(trimmed, candidate, matchedForm)
      if (!best || compareScore(score, best.score) > 0) {
        best = { item, label: candidate, matchedForm, score }
      }
    }
  }

  if (!best) {
    return { note: '' }
  }

  return {
    catalog: best.item,
    note: extractUnmatchedNote(trimmed, best.matchedForm),
  }
}

function matchedPhraseForm(haystack: string, phrase: string): string | undefined {
  const trimmed = haystack.trim()
  let best: string | undefined
  for (const form of inflectionForms(phrase)) {
    if (!flexiblePhrasePattern(form).test(trimmed)) {
      continue
    }
    if (!best || form.length > best.length) {
      best = form
    }
  }
  return best
}

function phraseMatchScore(
  haystack: string,
  candidate: string,
  matchedForm: string
): [number, number, number] {
  const match = flexiblePhrasePattern(matchedForm).exec(haystack.trim())
  const wordCount = normalizeIngredientKey(candidate).split(' ').filter(Boolean).length
  const end = match ? match.index + match[0].length : -1
  return [wordCount, end, candidate.length]
}

function compareScore(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) {
      return delta
    }
  }
  return 0
}

function extractUnmatchedNote(importedName: string, matchedLabel: string): string {
  const imported = importedName.trim()
  const match = flexiblePhrasePattern(matchedLabel).exec(imported)
  if (!match) {
    return imported
  }
  const before = imported.slice(0, match.index).trim()
  const after = imported.slice(match.index + match[0].length).trim()
  return [before, after].filter(Boolean).join(' ')
}

function flexiblePhrasePattern(phrase: string): RegExp {
  const parts = normalizeIngredientKey(phrase).split(' ').filter(Boolean).map(escapeRegExp)
  const body = parts.join('[\\s-]+')
  return new RegExp(`(^|[\\s(,])${body}(?=[\\s,.)]|$)`, 'i')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function densityForName(
  name: string,
  catalog: CatalogIngredient[]
): number | null | undefined {
  return findCatalogIngredient(name, catalog)?.density_kg_m3
}

const UNIT_DISPLAY_LABELS: Record<string, string> = {
  cup: 'cups',
  g: 'grams',
  kg: 'kilograms',
  lb: 'pounds',
  oz: 'ounces',
  quart: 'quarts',
  Tbsp: 'tablespoons',
  tsp: 'teaspoons',
}

export function unitDisplayLabel(unit: string): string {
  return UNIT_DISPLAY_LABELS[unit] ?? unit
}

export function editorUnitItems(
  unitSystem: UnitSystem
): Array<{ label: string; value: string } | { type: 'header'; label: string }> {
  const metric = ['g', 'kg'].map(unit => ({
    label: unitDisplayLabel(unit),
    value: unit,
  }))
  const us = ['cup', 'Tbsp', 'tsp', 'quart', 'lb', 'oz'].map(unit => ({
    label: unitDisplayLabel(unit),
    value: unit,
  }))
  const groups =
    unitSystem === 'metric'
      ? [
          { header: 'Metric', items: metric },
          { header: 'US', items: us },
        ]
      : [
          { header: 'US', items: us },
          { header: 'Metric', items: metric },
        ]

  const items: Array<{ label: string; value: string } | { type: 'header'; label: string }> = []
  for (const group of groups) {
    items.push({ type: 'header', label: group.header })
    items.push(...group.items)
  }
  return items
}

export function defaultEditorUnit(unitSystem: UnitSystem): string {
  if (unitSystem === 'metric') {
    return 'g'
  }
  if (unitSystem === 'us_weight') {
    return 'oz'
  }
  return 'cup'
}

function trimNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, '')
}
