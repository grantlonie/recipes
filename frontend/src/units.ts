import { formatQuantityDisplay, parseQuantity } from './quantities'
import type { CatalogIngredient, UnitSystem } from './types'

export const ML_PER_CUP = 236.5882365
export const ML_PER_TBSP = ML_PER_CUP / 16
export const ML_PER_TSP = ML_PER_CUP / 48
export const ML_PER_FL_OZ = ML_PER_CUP / 8
export const ML_PER_QUART = ML_PER_CUP * 4
export const ML_PER_PINT = ML_PER_CUP * 2
export const ML_PER_GALLON = ML_PER_CUP * 16
export const G_PER_OZ = 28.349523125
export const G_PER_LB = 453.59237

const FLUID_VOLUME_TAGS = new Set(['cocktail', 'drink', 'mocktail'])

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
  'fl oz': 'fl oz',
  floz: 'fl oz',
  'fl. oz': 'fl oz',
  'fl. oz.': 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
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
  'fl oz': ML_PER_FL_OZ,
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

function formatMetricVolume(grams: number, densityKgM3: number): DisplayAmount {
  const ml = (grams * 1000) / densityKgM3
  const sign = ml < 0 ? '-' : ''
  const value = Math.abs(ml)
  if (value >= 1000) {
    const liters = value / 1000
    if (Math.abs(liters - Math.round(liters)) < 0.05) {
      return { quantity: sign + String(Math.round(liters)), unit: 'l' }
    }
    return { quantity: sign + trimNumber(liters, 1), unit: 'l' }
  }
  if (value < 10) {
    return { quantity: sign + trimNumber(value, 1), unit: 'ml' }
  }
  return { quantity: sign + String(Math.round(value)), unit: 'ml' }
}

function formatUsVolume(
  grams: number,
  densityKgM3: number,
  options: { preferFlOz?: boolean } = {}
): DisplayAmount {
  const ml = (grams * 1000) / densityKgM3
  if (options.preferFlOz) {
    return {
      quantity: formatQuantityDisplay(String(ml / ML_PER_FL_OZ)),
      unit: 'fl oz',
    }
  }
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

export function prefersFluidVolume(tags: string[] | null | undefined): boolean {
  if (!tags?.length) {
    return false
  }
  return tags.some(tag => FLUID_VOLUME_TAGS.has(tag.trim().toLowerCase()))
}

function formatAmountFromGrams(
  grams: number,
  options: {
    unitSystem: UnitSystem
    densityKgM3?: number | null
    preferFluidVolume?: boolean
  }
): DisplayAmount {
  const hasDensity = options.densityKgM3 != null && options.densityKgM3 > 0
  if (options.preferFluidVolume && hasDensity) {
    if (options.unitSystem === 'metric') {
      return formatMetricVolume(grams, options.densityKgM3 as number)
    }
    return formatUsVolume(grams, options.densityKgM3 as number, { preferFlOz: true })
  }
  if (options.unitSystem === 'us_weight') {
    return formatUsMass(grams)
  }
  if (options.unitSystem === 'us') {
    if (hasDensity) {
      return formatUsVolume(grams, options.densityKgM3 as number)
    }
    return formatUsMass(grams)
  }
  return formatMetricMass(grams)
}

export function formatAmount(
  quantity: number | null,
  unit: string | null | undefined,
  options: {
    unitSystem: UnitSystem
    densityKgM3?: number | null
    preferFluidVolume?: boolean
  }
): DisplayAmount {
  if (quantity === null) {
    return { quantity: '', unit: normalizeUnit(unit) }
  }

  const canonical = normalizeUnit(unit)
  const authored: DisplayAmount = {
    quantity: formatQuantityDisplay(String(quantity)),
    unit: canonical ?? unit ?? null,
  }

  if (!canonical || (!isMassUnit(canonical) && !isVolumeUnit(canonical))) {
    return authored
  }

  const grams = toGrams(quantity, canonical, options.densityKgM3)
  if (grams == null) {
    return authored
  }
  return formatAmountFromGrams(grams, options)
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
    preferFluidVolume?: boolean
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

export function foldAccents(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '')
}

export function normalizeIngredientKey(value: string): string {
  return foldAccents(value)
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
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

/** Words allowed in leftover notes for partial catalog matches. */
const MODIFIER_WORDS = new Set([
  'black',
  'brown',
  'cayenne',
  'chopped',
  'coarse',
  'coarsely',
  'cold',
  'cooked',
  'cracked',
  'crushed',
  'dark',
  'diced',
  'dried',
  'dry',
  'extra',
  'fine',
  'finely',
  'firmly',
  'fresh',
  'freshly',
  'frozen',
  'green',
  'ground',
  'halved',
  'hot',
  'jumbo',
  'kosher',
  'large',
  'light',
  'lightly',
  'medium',
  'minced',
  'organic',
  'packed',
  'pure',
  'raw',
  'red',
  'roasted',
  'room',
  'salted',
  'sea',
  'sliced',
  'small',
  'smoked',
  'softened',
  'sour',
  'sweet',
  'toasted',
  'unsalted',
  'virgin',
  'white',
  'whole',
  'yellow',
])

/** Leftover tokens that mean the matched catalog item is the wrong substance. */
const SUBSTANCE_CHANGE_TOKENS = new Set([
  'aperitivo',
  'bean',
  'beans',
  'bell',
  'brine',
  'broth',
  'butter',
  'cheese',
  'chips',
  'chutney',
  'condensed',
  'cream',
  'extract',
  'flour',
  'jam',
  'jelly',
  'juice',
  'liqueur',
  'meal',
  'milk',
  'mix',
  'nectar',
  'oil',
  'paste',
  'powder',
  'preserves',
  'pudding',
  'puree',
  'relish',
  'rind',
  'sauce',
  'stock',
  'sweetened',
  'syrup',
  'vinegar',
  'wine',
  'yogurt',
  'zest',
])

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
    return { catalog: exact, note: noteForExactMatch(trimmed, exact) }
  }

  let best:
    | {
        item: CatalogIngredient
        label: string
        matchedForm: string
        score: [number, number, number]
      }
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

  const note = extractUnmatchedNote(trimmed, best.matchedForm)
  if (!partialMatchIsSafe(trimmed, best.matchedForm, note, best.item.name)) {
    return { note: '' }
  }
  return {
    catalog: best.item,
    note,
  }
}

function noteForExactMatch(importedName: string, item: CatalogIngredient): string {
  if (setsIntersect(inflectionForms(importedName), inflectionForms(item.name))) {
    return ''
  }

  const matchedCanonical = matchedPhraseForm(importedName, item.name)
  if (matchedCanonical) {
    // Only pre-head leftovers become notes (balsamic vinegar → balsamic).
    // Synonym aliases like corn kernels → corn stay note-free.
    if (!matchedPhraseIsSuffix(importedName, matchedCanonical)) {
      return ''
    }
    return extractUnmatchedNote(importedName, matchedCanonical)
  }

  const matchedLabel =
    [item.name, ...item.aliases].find(label =>
      setsIntersect(inflectionForms(importedName), inflectionForms(label))
    ) ?? item.name

  if (isExpandingAlias(matchedLabel, item.name)) {
    return ''
  }
  if (isModifierQualifiedHead(matchedLabel, item.name)) {
    return ''
  }

  const head = normalizeIngredientKey(item.name).split(' ').filter(Boolean).at(-1)
  if (!head) {
    return ''
  }
  const headForm = matchedPhraseForm(importedName, head)
  if (!headForm) {
    return ''
  }
  if (!matchedPhraseIsSuffix(importedName, headForm)) {
    return ''
  }
  return extractUnmatchedNote(importedName, headForm)
}

function matchedPhraseForm(haystack: string, phrase: string): string | undefined {
  const trimmed = haystack.trim()
  let best: string | undefined
  for (const form of inflectionForms(phrase)) {
    if (!phraseHit(trimmed, form)) {
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
  const hit = phraseHit(haystack.trim(), matchedForm)
  const wordCount = normalizeIngredientKey(candidate).split(' ').filter(Boolean).length
  const end = hit ? hit.end : -1
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
  const hit = phraseHit(imported, matchedLabel)
  if (!hit) {
    return imported
  }
  const before = hit.source.slice(0, hit.start).trim()
  const after = hit.source.slice(hit.end).trim()
  return [before, after].filter(Boolean).join(', ')
}

function partialMatchIsSafe(
  importedName: string,
  matchedForm: string,
  note: string,
  catalogName: string
): boolean {
  if (!note.trim()) {
    return true
  }

  const tokens = normalizeIngredientKey(note).split(' ').filter(Boolean)
  if (!tokens.length) {
    return true
  }
  if (tokens.every(token => MODIFIER_WORDS.has(token))) {
    return true
  }
  if (tokens.some(token => SUBSTANCE_CHANGE_TOKENS.has(token))) {
    return false
  }
  if (isExpandingAlias(matchedForm, catalogName)) {
    return false
  }
  if (matchedPhraseIsSuffix(importedName, matchedForm)) {
    return true
  }
  return false
}

function isExpandingAlias(matchedForm: string, catalogName: string): boolean {
  if (setsIntersect(inflectionForms(matchedForm), inflectionForms(catalogName))) {
    return false
  }
  const matchedTokens = new Set(normalizeIngredientKey(matchedForm).split(' ').filter(Boolean))
  const catalogTokens = new Set(normalizeIngredientKey(catalogName).split(' ').filter(Boolean))
  if (!matchedTokens.size) {
    return false
  }
  for (const token of matchedTokens) {
    if (!catalogTokens.has(token)) {
      return false
    }
  }
  return matchedTokens.size < catalogTokens.size
}

function isModifierQualifiedHead(matchedLabel: string, catalogName: string): boolean {
  const head = normalizeIngredientKey(catalogName).split(' ').filter(Boolean).at(-1)
  if (!head) {
    return false
  }
  const labelTokens = normalizeIngredientKey(matchedLabel).split(' ').filter(Boolean)
  if (labelTokens.length < 2) {
    return false
  }
  const last = labelTokens[labelTokens.length - 1] ?? ''
  if (!inflectionForms(head).includes(last)) {
    return false
  }
  return labelTokens.slice(0, -1).every(token => MODIFIER_WORDS.has(token))
}

function matchedPhraseIsSuffix(importedName: string, matchedForm: string): boolean {
  const hit = phraseHit(importedName.trim(), matchedForm)
  if (!hit) {
    return false
  }
  const after = hit.source.slice(hit.end).replace(/^[\s,.]+|[\s,.]+$/g, '')
  return !after
}

function phraseHit(
  haystack: string,
  phrase: string
): { end: number; source: string; start: number } | undefined {
  const pattern = flexiblePhrasePattern(phrase)
  const direct = pattern.exec(haystack)
  if (direct) {
    return {
      end: direct.index + direct[0].length,
      source: haystack,
      start: direct.index,
    }
  }
  const folded = foldAccents(haystack)
  if (folded === haystack) {
    return undefined
  }
  const foldedMatch = pattern.exec(folded)
  if (!foldedMatch) {
    return undefined
  }
  return {
    end: foldedMatch.index + foldedMatch[0].length,
    source: folded,
    start: foldedMatch.index,
  }
}

function flexiblePhrasePattern(phrase: string): RegExp {
  const parts = normalizeIngredientKey(phrase).split(' ').filter(Boolean).map(escapeRegExp)
  const body = parts.join('[\\s-]+')
  return new RegExp(`(^|[\\s(,])${body}(?=[\\s,.)]|$)`, 'i')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function setsIntersect(left: Iterable<string>, right: Iterable<string>): boolean {
  const rightSet = right instanceof Set ? right : new Set(right)
  for (const value of left) {
    if (rightSet.has(value)) {
      return true
    }
  }
  return false
}

export function densityForName(
  name: string,
  catalog: CatalogIngredient[]
): number | null | undefined {
  return findCatalogIngredient(name, catalog)?.density_kg_m3
}

export function hasUsableDensity(name: string, catalog: CatalogIngredient[]): boolean {
  const density = densityForName(name, catalog)
  return density != null && density > 0
}

const METRIC_UNITS = new Set(['g', 'kg', 'ml', 'l'])
const METRIC_VOLUME_UNITS = new Set(['ml', 'l'])
const US_MASS_UNITS = new Set(['oz', 'lb'])
const US_VOLUME_UNITS = new Set(['cup', 'Tbsp', 'tsp', 'fl oz', 'quart', 'pint', 'gallon'])

/** Majority vote over convertible ingredient units; null on empty or tie. */
export function detectRecipeUnitSystem(
  ingredients: Array<{ unit?: string | null }>
): UnitSystem | null {
  let us = 0
  let usWeight = 0
  let metric = 0

  for (const ingredient of ingredients) {
    const canonical = normalizeUnit(ingredient.unit)
    if (!canonical) {
      continue
    }
    if (US_VOLUME_UNITS.has(canonical)) {
      us += 1
    } else if (US_MASS_UNITS.has(canonical)) {
      usWeight += 1
    } else if (METRIC_UNITS.has(canonical)) {
      metric += 1
    }
  }

  const max = Math.max(us, usWeight, metric)
  if (max === 0) {
    return null
  }
  const winners: UnitSystem[] = []
  if (us === max) {
    winners.push('us')
  }
  if (usWeight === max) {
    winners.push('us_weight')
  }
  if (metric === max) {
    winners.push('metric')
  }
  return winners.length === 1 ? winners[0] : null
}

/**
 * True when converting the authored unit into the selected system needs density
 * (volume↔mass, or cross-family volume). Count / unknown units never need it.
 */
export function ingredientNeedsDensity(
  unit: string | null | undefined,
  unitSystem: UnitSystem,
  preferFluidVolume = false
): boolean {
  const canonical = normalizeUnit(unit)
  if (!canonical || (!isMassUnit(canonical) && !isVolumeUnit(canonical))) {
    return false
  }

  if (preferFluidVolume) {
    if (isMassUnit(canonical)) {
      return true
    }
    if (unitSystem === 'metric') {
      return !METRIC_VOLUME_UNITS.has(canonical)
    }
    return !US_VOLUME_UNITS.has(canonical)
  }

  if (unitSystem === 'metric') {
    return isVolumeUnit(canonical)
  }

  if (unitSystem === 'us_weight') {
    return isVolumeUnit(canonical)
  }

  // Cups: mass→volume needs density; non-US volume→cups needs density.
  if (isMassUnit(canonical)) {
    return true
  }
  return !US_VOLUME_UNITS.has(canonical)
}

const UNIT_DISPLAY_LABELS: Record<string, string> = {
  cup: 'cups',
  'fl oz': 'fl oz',
  g: 'grams',
  kg: 'kilograms',
  l: 'liters',
  lb: 'pounds',
  ml: 'milliliters',
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
  const metric = ['g', 'kg', 'ml', 'l'].map(unit => ({
    label: unitDisplayLabel(unit),
    value: unit,
  }))
  const us = ['cup', 'Tbsp', 'tsp', 'fl oz', 'quart', 'lb', 'oz'].map(unit => ({
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
