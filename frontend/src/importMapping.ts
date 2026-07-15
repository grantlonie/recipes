import { estimateIngredientDensities, getIngredientCatalog, upsertIngredient } from './api'
import {
  extractTokens,
  ingredientToPlainText,
  INGREDIENT_TOKEN_RE,
  serializeIngredient,
  type IngredientToken,
} from './cooklangTokens'
import { putIngredientCatalog } from './db'
import { parseQuantity } from './quantities'
import type { CatalogIngredient } from './types'
import {
  findCatalogIngredient,
  formatGramsValue,
  isMassUnit,
  isVolumeUnit,
  matchCatalogIngredient,
  normalizeUnit,
  toGrams,
  withLearnedAlias,
} from './units'

export interface MappingRow {
  catalogName: string
  createDensity: string
  excluded: boolean
  fixed: boolean
  note: string
  originalName: string
  quantity: string
  unit: string
}

export interface PendingImport {
  body: string
  metadata: Record<string, unknown>
  preserveBookmarked?: boolean
  /** Keep file images; keep URL/empty only when import has no image. */
  preserveImage?: boolean
  preserveSource?: boolean
  preserveTags?: boolean
  suggestedSlug?: string
}

/** Reimport: never replace a local image file with a web URL; otherwise prefer imported. */
export function mergePreservedImage(current: string, imported: string): string {
  const existing = current.trim()
  const next = imported.trim()
  if (isRefFile(existing)) {
    return existing
  }
  return next || existing
}

export function isRefFile(value: string): boolean {
  const trimmed = value.trim()
  if (/^(?:source|image)\.[A-Za-z0-9]+$/.test(trimmed)) {
    return true
  }
  return /^recipes\/[^/]+\/(?:source|image)\.[A-Za-z0-9]+$/.test(trimmed)
}

export function resolveRefDisplay(value: string, slug?: string): string {
  const trimmed = value.trim()
  if (/^(?:source|image)\.[A-Za-z0-9]+$/.test(trimmed)) {
    if (!slug) {
      return trimmed
    }
    return `/api/sources/${slug}/${trimmed}`
  }
  if (trimmed.startsWith('recipes/')) {
    return `/api/sources/${trimmed.slice('recipes/'.length)}`
  }
  return trimmed
}

export function parseImportedDocument(content: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) {
    return { body: content, metadata: {} as Record<string, unknown> }
  }
  return { body: content.slice(match[0].length), metadata: parseSimpleMetadata(match[1]) }
}

export function renderImportDocument(metadata: Record<string, unknown>, body: string): string {
  const lines = Object.entries(metadata)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== '' && !isEmptyArray(value)
    )
    .flatMap(([key, value]) => renderMetadataValue(key, value))
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`
}

export function buildMappingRows(
  body: string,
  unmatchedIngredients: string[],
  catalog: CatalogIngredient[]
): MappingRow[] {
  const tokens = extractTokens(body)
  const unique = new Map<string, IngredientToken>()
  for (const token of tokens) {
    const key = `${token.name.toLowerCase()}|${token.unit.toLowerCase()}`
    if (!unique.has(key)) {
      unique.set(key, token)
    }
  }

  const unmatchedSet = new Set(unmatchedIngredients.map(name => name.toLowerCase()))
  return [...unique.values()]
    .filter(token => unmatchedSet.has(token.name.toLowerCase()))
    .map(token => {
      const match = matchCatalogIngredient(token.name, catalog)
      return {
        catalogName: match.catalog?.name ?? token.name,
        createDensity: '',
        excluded: false,
        fixed: token.fixed,
        note: mergeImportNotes(match.note, token.note),
        originalName: token.name,
        quantity: token.quantity,
        unit: normalizeUnit(token.unit) ?? token.unit,
      }
    })
}

export async function autofillMappingDensities<T extends MappingRow>(
  rows: T[],
  catalog: CatalogIngredient[],
  options: { attempted?: Set<string> } = {}
): Promise<T[]> {
  const attempted = options.attempted
  const names: string[] = []
  for (const row of rows) {
    if (row.excluded || row.createDensity.trim() || !mappingRowNeedsCreate(row, catalog)) {
      continue
    }
    const name = row.catalogName.trim() || row.originalName
    const key = name.toLowerCase()
    if (!name || attempted?.has(key)) {
      continue
    }
    names.push(name)
    attempted?.add(key)
  }
  if (!names.length) {
    return rows
  }

  try {
    const estimates = await estimateIngredientDensities(names)
    return applyDensityEstimates(rows, estimates)
  } catch {
    return rows
  }
}

export function applyDensityEstimates<T extends MappingRow>(
  rows: T[],
  estimates: Array<{ name: string; density_kg_m3?: number | null }>
): T[] {
  if (!estimates.length) {
    return rows
  }
  const byName = new Map(
    estimates.map(estimate => [estimate.name.toLowerCase(), estimate.density_kg_m3])
  )
  return rows.map(row => {
    if (row.excluded || row.createDensity.trim()) {
      return row
    }
    const name = (row.catalogName.trim() || row.originalName).toLowerCase()
    const density = byName.get(name)
    if (density == null || Number.isNaN(density) || density <= 0) {
      return row
    }
    return { ...row, createDensity: String(Math.round(density)) }
  })
}

export function mappingRowNeedsCreate(row: MappingRow, ingredients: CatalogIngredient[]): boolean {
  if (row.excluded) {
    return false
  }
  const name = row.catalogName.trim()
  if (!name) {
    return true
  }
  return !findCatalogIngredient(name, ingredients)
}

export function mappingRowNeedsDensity(row: MappingRow, ingredients: CatalogIngredient[]): boolean {
  return mappingRowNeedsCreate(row, ingredients) && isVolumeUnit(row.unit)
}

export function mappingRowDensityValid(row: MappingRow): boolean {
  const density = Number(row.createDensity.trim())
  return row.createDensity.trim() !== '' && !Number.isNaN(density) && density > 0
}

export function isMappingRowValid(row: MappingRow, ingredients: CatalogIngredient[]): boolean {
  if (row.excluded) {
    return true
  }
  if (!row.catalogName.trim()) {
    return false
  }
  if (mappingRowNeedsDensity(row, ingredients) && !mappingRowDensityValid(row)) {
    return false
  }
  return true
}

export function mappingRowsAreValid(rows: MappingRow[], ingredients: CatalogIngredient[]): boolean {
  return rows.every(row => isMappingRowValid(row, ingredients))
}

export async function upsertCatalogFromMappingRows(
  mappingRows: MappingRow[],
  catalog: CatalogIngredient[],
  refreshCatalog: () => Promise<void>
): Promise<CatalogIngredient[]> {
  const catalogUpdates: CatalogIngredient[] = []
  for (const row of mappingRows) {
    if (row.excluded) {
      continue
    }
    const catalogName = row.catalogName.trim()
    if (!catalogName) {
      continue
    }

    if (mappingRowNeedsCreate(row, catalog)) {
      const densityValue = row.createDensity.trim()
      const density = densityValue ? Number(densityValue) : null
      if (densityValue && Number.isNaN(density)) {
        continue
      }
      const base: CatalogIngredient = {
        aliases: [],
        density_kg_m3: density,
        name: catalogName,
      }
      const ingredient = await upsertIngredient(withLearnedAlias(base, row.originalName) ?? base)
      catalogUpdates.push(ingredient)
      continue
    }

    const existing = findCatalogIngredient(catalogName, catalog)
    if (!existing) {
      continue
    }
    const learned = withLearnedAlias(existing, row.originalName)
    if (!learned) {
      continue
    }
    const ingredient = await upsertIngredient(learned)
    catalogUpdates.push(ingredient)
  }

  if (!catalogUpdates.length) {
    return catalog
  }

  const nextCatalog = await getIngredientCatalog()
  await putIngredientCatalog(nextCatalog)
  await refreshCatalog()
  return nextCatalog.ingredients
}

export function applyMappingRowsToBody(
  body: string,
  mappingRows: MappingRow[],
  catalog: CatalogIngredient[]
): string {
  const lookup = new Map<string, MappingRow>()
  for (const row of mappingRows) {
    lookup.set(row.originalName.toLowerCase(), row)
  }

  return body.replace(INGREDIENT_TOKEN_RE, (full, bracedName, _amount, bareName) => {
    const name = (bracedName || bareName || '').trim()
    if (!name) {
      return full
    }
    const row = lookup.get(name.toLowerCase())
    if (!row) {
      return full
    }
    if (row.excluded) {
      return ingredientToPlainText({
        fixed: row.fixed,
        name: row.originalName,
        note: row.note,
        quantity: row.quantity,
        unit: row.unit,
      })
    }
    return buildMappedIngredientMarker(row, catalog)
  })
}

export async function applyImportMapping(
  pendingImport: PendingImport,
  mappingRows: MappingRow[],
  catalog: CatalogIngredient[],
  refreshCatalog: () => Promise<void>
): Promise<{ body: string; catalog: CatalogIngredient[] }> {
  const workingCatalog = await upsertCatalogFromMappingRows(mappingRows, catalog, refreshCatalog)
  const body = applyMappingRowsToBody(pendingImport.body, mappingRows, workingCatalog)
  return { body, catalog: workingCatalog }
}

function buildMappedIngredientMarker(row: MappingRow, catalog: CatalogIngredient[]): string {
  const targetName = row.catalogName.trim() || row.originalName
  const catalogItem = findCatalogIngredient(targetName, catalog)
  const density = catalogItem?.density_kg_m3
  let quantity = row.quantity
  let unit = row.unit

  const parsed = parseQuantity(row.quantity)
  if (parsed !== null && row.unit) {
    let grams: number | null = null
    if (isMassUnit(row.unit)) {
      grams = toGrams(parsed, row.unit)
    } else if (isVolumeUnit(row.unit)) {
      grams = toGrams(parsed, row.unit, density)
    }
    if (grams !== null) {
      quantity = formatGramsValue(grams)
      unit = 'g'
    } else {
      unit = normalizeUnit(row.unit) ?? row.unit
    }
  }

  return serializeIngredient({
    fixed: row.fixed,
    name: targetName,
    note: row.note,
    quantity,
    unit,
  })
}

function mergeImportNotes(...parts: Array<string | null | undefined>): string {
  return parts
    .map(part => part?.trim())
    .filter(Boolean)
    .join(', ')
}

function parseSimpleMetadata(frontMatter: string) {
  const metadata: Record<string, unknown> = {}
  const lines = frontMatter.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const pair = line.match(/^([^:#]+):\s*(.*)$/)
    if (!pair) {
      continue
    }
    const key = pair[1].trim()
    const rawValue = pair[2].trim()
    if (rawValue) {
      metadata[key] = parseScalar(rawValue)
      continue
    }
    const list: string[] = []
    while (lines[index + 1]?.match(/^\s*-\s+/)) {
      index += 1
      const item = lines[index].replace(/^\s*-\s+/, '').trim()
      list.push(String(parseScalar(item)))
    }
    metadata[key] = list
  }
  cleanMetadataNotes(metadata)
  return metadata
}

function renderMetadataValue(key: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    const quoteLists = key === 'review' || key === 'import_notes'
    return [
      key + ':',
      ...value.map(item => {
        const text = String(item)
        return `  - ${quoteLists ? JSON.stringify(text) : escapeScalar(text)}`
      }),
    ]
  }
  if (typeof value === 'boolean') {
    return [`${key}: ${value ? 'true' : 'false'}`]
  }
  if (typeof value === 'number') {
    return [`${key}: ${value}`]
  }
  return [`${key}: ${escapeScalar(String(value))}`]
}

function escapeScalar(value: string) {
  if (yamlScalarNeedsQuotes(value)) {
    return JSON.stringify(value)
  }
  return value
}

function yamlScalarNeedsQuotes(value: string): boolean {
  if (!value) {
    return true
  }
  if (/[:#"'[\]{}>&*!|@%`]/.test(value)) {
    return true
  }
  if (/^\s|\s$/.test(value)) {
    return true
  }
  if (/[\n\r\t]/.test(value)) {
    return true
  }
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) {
    return true
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return true
  }
  return false
}

function parseScalar(value: string) {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string
    } catch {
      return cleanNoteText(value.slice(1, -1))
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return cleanNoteText(value.slice(1, -1).replaceAll("''", "'"))
  }
  const numeric = Number(value)
  return Number.isNaN(numeric) ? value : numeric
}

function cleanMetadataNotes(metadata: Record<string, unknown>) {
  for (const key of ['description', 'introduction'] as const) {
    const value = metadata[key]
    if (typeof value === 'string') {
      const cleaned = cleanNoteText(value)
      if (cleaned) {
        metadata[key] = cleaned
      } else {
        delete metadata[key]
      }
    }
  }
}

function cleanNoteText(value: string) {
  let text = value.trim()
  while (text.length >= 2 && (text.startsWith('"') || text.startsWith("'")) && text.endsWith('\\')) {
    text = text.slice(1, -1).trimEnd()
  }
  if (
    text.length >= 2 &&
    text[0] === text[text.length - 1] &&
    (text[0] === '"' || text[0] === "'")
  ) {
    const inner = text.slice(1, -1)
    if (text[0] === "'" || !inner.includes('"')) {
      text = inner.trim()
    }
  }
  if (text.startsWith('"') && text.split('"').length === 2) {
    text = text.slice(1)
  }
  if (text.startsWith("'") && text.split("'").length === 2) {
    text = text.slice(1)
  }
  text = text.replace(/\\+$/, '').trim()
  return decodeUnicodeEscapes(text).trim()
}

function decodeUnicodeEscapes(value: string) {
  return value.replace(/\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (_, short, long) =>
    String.fromCodePoint(Number.parseInt(short || long, 16))
  )
}

function isEmptyArray(value: unknown) {
  return Array.isArray(value) && value.length === 0
}
