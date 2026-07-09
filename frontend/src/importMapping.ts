import { getIngredientCatalog, upsertIngredient } from './api'
import {
  extractTokens,
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
  preserveTags?: boolean
  suggestedSlug?: string
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
      ([, value]) => value !== undefined && value !== null && value !== '' && !isEmptyArray(value),
    )
    .flatMap(([key, value]) => renderMetadataValue(key, value))
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`
}

export function buildMappingRows(
  body: string,
  unmatchedIngredients: string[],
  catalog: CatalogIngredient[],
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
        fixed: token.fixed,
        note: mergeImportNotes(match.note, token.note),
        originalName: token.name,
        quantity: token.quantity,
        unit: normalizeUnit(token.unit) ?? token.unit,
      }
    })
}

export function mappingRowNeedsCreate(row: MappingRow, ingredients: CatalogIngredient[]): boolean {
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

export async function applyImportMapping(
  pendingImport: PendingImport,
  mappingRows: MappingRow[],
  catalog: CatalogIngredient[],
  refreshCatalog: () => Promise<void>,
): Promise<{ body: string; catalog: CatalogIngredient[] }> {
  const catalogUpdates: CatalogIngredient[] = []
  for (const row of mappingRows) {
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

  let workingCatalog = catalog
  if (catalogUpdates.length) {
    const nextCatalog = await getIngredientCatalog()
    await putIngredientCatalog(nextCatalog)
    await refreshCatalog()
    workingCatalog = nextCatalog.ingredients
  }

  const lookup = new Map<string, MappingRow>()
  for (const row of mappingRows) {
    lookup.set(row.originalName.toLowerCase(), row)
  }

  const body = pendingImport.body.replace(
    INGREDIENT_TOKEN_RE,
    (full, bracedName, _amount, bareName) => {
      const name = (bracedName || bareName || '').trim()
      if (!name) {
        return full
      }
      const row = lookup.get(name.toLowerCase())
      if (!row) {
        return full
      }
      return buildMappedIngredientMarker(row, workingCatalog)
    },
  )

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
    while (lines[index + 1]?.trim().startsWith('- ')) {
      index += 1
      list.push(lines[index].trim().slice(2).trim())
    }
    metadata[key] = list
  }
  return metadata
}

function renderMetadataValue(key: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return [key + ':', ...value.map(item => `  - ${escapeScalar(String(item))}`)]
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
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  const numeric = Number(value)
  return Number.isNaN(numeric) ? value : numeric
}

function isEmptyArray(value: unknown) {
  return Array.isArray(value) && value.length === 0
}
