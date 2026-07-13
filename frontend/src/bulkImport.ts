import { getRecipes, importRecipeUpload } from './api'
import { extractTokens } from './cooklangTokens'
import {
  applyMappingRowsToBody,
  buildMappingRows,
  parseImportedDocument,
  renderImportDocument,
  upsertCatalogFromMappingRows,
  type MappingRow,
} from './importMapping'
import { finalizeImportedRecipe } from './importRecipeFlow'
import { sourceUrlKey } from './shareImport'
import type { CatalogIngredient, ImportPreview, RecipeSummary } from './types'
import { matchCatalogIngredient, normalizeUnit } from './units'

export type BulkItemStatus =
  | 'queued'
  | 'converting'
  | 'pending'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'skipped'
  | 'failed'

export interface BulkImportItem {
  body: string
  error?: string
  file: File
  fileName: string
  id: string
  metadata: Record<string, unknown>
  savedSlug?: string
  skipReason?: string
  sourceUrl?: string
  status: BulkItemStatus
  suggestedSlug: string
  unmatchedNames: string[]
  validationWarnings: string[]
}

export interface BulkUnmatchedRow extends MappingRow {
  recipeCount: number
  recipeIds: string[]
}

export interface BulkExistingIndex {
  bySlug: Set<string>
  bySourceUrl: Map<string, RecipeSummary>
}

export const BULK_CONVERT_CONCURRENCY = 4
const SOURCE_URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i
const SOURCE_PEEK_BYTES = 8_192

export function createBulkImportItems(files: File[]): BulkImportItem[] {
  return files.map((file, index) => ({
    body: '',
    file,
    fileName: file.name,
    id: `${index}-${file.name}-${file.size}-${file.lastModified}`,
    metadata: {},
    status: 'queued',
    suggestedSlug: '',
    unmatchedNames: [],
    validationWarnings: [],
  }))
}

export function extractHttpUrlFromText(text: string): string | null {
  const match = text.match(SOURCE_URL_RE)
  if (!match) {
    return null
  }
  return match[0].replace(/[.,;:!?)]+$/, '')
}

export async function peekSourceUrlFromFile(file: File): Promise<string | null> {
  const name = file.name.toLowerCase()
  const isTextLike =
    file.type.startsWith('text/') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown') ||
    name.endsWith('.html') ||
    name.endsWith('.htm')
  if (!isTextLike) {
    return null
  }

  try {
    const chunk = file.slice(0, SOURCE_PEEK_BYTES)
    const text = await chunk.text()
    return extractHttpUrlFromText(text)
  } catch {
    return null
  }
}

export function sourceUrlFromMetadata(metadata: Record<string, unknown>): string | null {
  const value = metadata.source
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return null
  }
  return trimmed
}

export function skipIfExistingRecipe(
  item: BulkImportItem,
  existing: BulkExistingIndex
): BulkImportItem | null {
  if (!item.sourceUrl) {
    return null
  }
  const match = existing.bySourceUrl.get(sourceUrlKey(item.sourceUrl))
  if (!match) {
    return null
  }
  return {
    ...item,
    body: '',
    metadata: {},
    savedSlug: match.slug,
    skipReason: `Already imported as ${match.title}`,
    status: 'skipped',
    unmatchedNames: [],
    validationWarnings: [],
  }
}

export function mergePreviewIntoItem(
  item: BulkImportItem,
  preview: ImportPreview,
  catalog: CatalogIngredient[],
  existing?: BulkExistingIndex
): BulkImportItem {
  const parsed = parseImportedDocument(preview.content)
  const sourceUrl = sourceUrlFromMetadata(parsed.metadata) ?? item.sourceUrl
  const next: BulkImportItem = {
    ...item,
    body: parsed.body,
    error: undefined,
    metadata: parsed.metadata,
    sourceUrl: sourceUrl ?? undefined,
    status: 'pending',
    suggestedSlug: preview.suggested_slug,
    unmatchedNames: (preview.unmatched_ingredients ?? []).map(name => name.toLowerCase()),
    validationWarnings: preview.validation_warnings ?? [],
  }

  if (existing) {
    const skipped = skipIfExistingRecipe(next, existing)
    if (skipped) {
      return skipped
    }
  }

  return withReadyStatus(reconcileItemAgainstCatalog(next, catalog))
}

export function reconcileItemAgainstCatalog(
  item: BulkImportItem,
  catalog: CatalogIngredient[]
): BulkImportItem {
  if (!item.body || item.unmatchedNames.length === 0) {
    return item
  }

  const autoRows: MappingRow[] = []
  const remaining: string[] = []
  for (const name of item.unmatchedNames) {
    const match = matchCatalogIngredient(name, catalog)
    if (!match.catalog) {
      remaining.push(name)
      continue
    }
    const token = extractTokens(item.body).find(entry => entry.name.toLowerCase() === name)
    autoRows.push({
      catalogName: match.catalog.name,
      createDensity: '',
      excluded: false,
      fixed: token?.fixed ?? false,
      note: [match.note, token?.note].filter(Boolean).join(', '),
      originalName: token?.name ?? name,
      quantity: token?.quantity ?? '',
      unit: normalizeUnit(token?.unit ?? '') ?? token?.unit ?? '',
    })
  }

  if (!autoRows.length) {
    return { ...item, unmatchedNames: remaining }
  }

  return {
    ...item,
    body: applyMappingRowsToBody(item.body, autoRows, catalog),
    unmatchedNames: remaining,
  }
}

export function withReadyStatus(item: BulkImportItem): BulkImportItem {
  if (item.status !== 'pending' && item.status !== 'ready') {
    return item
  }
  return {
    ...item,
    status: item.unmatchedNames.length === 0 ? 'ready' : 'pending',
  }
}

export function buildBulkUnmatchedQueue(
  items: BulkImportItem[],
  catalog: CatalogIngredient[]
): BulkUnmatchedRow[] {
  const byKey = new Map<string, BulkUnmatchedRow>()

  for (const item of items) {
    if (item.status !== 'pending' && item.status !== 'ready') {
      continue
    }
    if (!item.body || item.unmatchedNames.length === 0) {
      continue
    }

    const rows = buildMappingRows(item.body, item.unmatchedNames, catalog)
    for (const row of rows) {
      const key = `${row.originalName.toLowerCase()}|${row.unit.toLowerCase()}`
      const existing = byKey.get(key)
      if (existing) {
        if (!existing.recipeIds.includes(item.id)) {
          existing.recipeIds.push(item.id)
          existing.recipeCount += 1
        }
        continue
      }
      byKey.set(key, {
        ...row,
        recipeCount: 1,
        recipeIds: [item.id],
      })
    }
  }

  return [...byKey.values()].sort((left, right) => {
    if (right.recipeCount !== left.recipeCount) {
      return right.recipeCount - left.recipeCount
    }
    return left.originalName.localeCompare(right.originalName, undefined, { sensitivity: 'base' })
  })
}

export function applyBulkMappingRows(
  items: BulkImportItem[],
  mappingRows: MappingRow[],
  catalog: CatalogIngredient[]
): BulkImportItem[] {
  if (!mappingRows.length) {
    return items
  }

  const originalNames = new Set(mappingRows.map(row => row.originalName.toLowerCase()))

  return items.map(item => {
    if (item.status !== 'pending' && item.status !== 'ready') {
      return item
    }
    if (!item.body) {
      return item
    }

    const touched = item.unmatchedNames.some(name => originalNames.has(name))
    if (!touched) {
      return withReadyStatus(item)
    }

    return withReadyStatus({
      ...item,
      body: applyMappingRowsToBody(item.body, mappingRows, catalog),
      unmatchedNames: item.unmatchedNames.filter(name => !originalNames.has(name)),
    })
  })
}

export async function commitBulkMappingRows(
  items: BulkImportItem[],
  mappingRows: MappingRow[],
  catalog: CatalogIngredient[],
  refreshCatalog: () => Promise<void>
): Promise<{ catalog: CatalogIngredient[]; items: BulkImportItem[] }> {
  const nextCatalog = await upsertCatalogFromMappingRows(mappingRows, catalog, refreshCatalog)
  const nextItems = applyBulkMappingRows(items, mappingRows, nextCatalog)
  return { catalog: nextCatalog, items: nextItems }
}

export function buildBulkItemContent(item: BulkImportItem): string {
  return renderImportDocument(item.metadata, item.body)
}

export function countBulkProgress(items: BulkImportItem[]) {
  const total = items.length
  let converted = 0
  let failed = 0
  let pendingMapping = 0
  let ready = 0
  let saved = 0
  let skipped = 0
  let converting = 0
  let queued = 0

  for (const item of items) {
    switch (item.status) {
      case 'queued':
        queued += 1
        break
      case 'converting':
        converting += 1
        break
      case 'pending':
        converted += 1
        pendingMapping += 1
        break
      case 'ready':
        converted += 1
        ready += 1
        break
      case 'saving':
        converted += 1
        break
      case 'saved':
        converted += 1
        saved += 1
        break
      case 'skipped':
        skipped += 1
        break
      case 'failed':
        failed += 1
        break
    }
  }

  return {
    converted,
    converting,
    failed,
    pendingMapping,
    queued,
    ready,
    saved,
    skipped,
    total,
  }
}

export async function runBulkConvertQueue(options: {
  concurrency?: number
  getCatalog: () => CatalogIngredient[]
  getExisting: () => BulkExistingIndex
  items: BulkImportItem[]
  onItemsChange: (updater: (current: BulkImportItem[]) => BulkImportItem[]) => void
  shouldContinue?: () => boolean
  skipExistingBySourceUrl?: boolean
}): Promise<void> {
  const concurrency = options.concurrency ?? BULK_CONVERT_CONCURRENCY
  const skipBySource = options.skipExistingBySourceUrl !== false
  const pending = options.items.filter(item => item.status === 'queued' || item.status === 'failed')
  let cursor = 0

  async function worker() {
    while (cursor < pending.length) {
      if (options.shouldContinue && !options.shouldContinue()) {
        return
      }
      const index = cursor
      cursor += 1
      const item = pending[index]

      options.onItemsChange(current =>
        current.map(entry =>
          entry.id === item.id
            ? { ...entry, error: undefined, status: 'converting' as const }
            : entry
        )
      )

      try {
        let working: BulkImportItem = item
        if (skipBySource) {
          const peekedUrl = await peekSourceUrlFromFile(item.file)
          if (peekedUrl) {
            working = { ...item, sourceUrl: peekedUrl }
            const skipped = skipIfExistingRecipe(working, options.getExisting())
            if (skipped) {
              options.onItemsChange(current =>
                current.map(entry => (entry.id === item.id ? skipped : entry))
              )
              continue
            }
          }
        }

        const preview = await importRecipeUpload(working.file)
        const catalog = options.getCatalog()
        const merged = mergePreviewIntoItem(
          working,
          preview,
          catalog,
          skipBySource ? options.getExisting() : undefined
        )
        options.onItemsChange(current =>
          current.map(entry => (entry.id === item.id ? merged : entry))
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed'
        options.onItemsChange(current =>
          current.map(entry =>
            entry.id === item.id ? { ...entry, error: message, status: 'failed' as const } : entry
          )
        )
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () => worker())
  await Promise.all(workers)
}

export async function saveBulkImportItem(
  item: BulkImportItem,
  options: {
    existing: BulkExistingIndex
    skipExistingBySlug: boolean
    usedSlugs: Set<string>
  }
): Promise<BulkImportItem> {
  if (item.sourceUrl) {
    const match = options.existing.bySourceUrl.get(sourceUrlKey(item.sourceUrl))
    if (match) {
      return {
        ...item,
        savedSlug: match.slug,
        skipReason: `Already imported as ${match.title}`,
        status: 'skipped',
      }
    }
  }

  const baseSlug = item.suggestedSlug.trim() || 'new-recipe'

  if (options.skipExistingBySlug && options.existing.bySlug.has(baseSlug)) {
    return {
      ...item,
      savedSlug: baseSlug,
      skipReason: 'Recipe with this slug already exists',
      status: 'skipped',
    }
  }

  const slug = allocateUniqueSlug(baseSlug, options.existing.bySlug, options.usedSlugs)
  options.usedSlugs.add(slug)
  const content = buildBulkItemContent(item)
  const recipe = await finalizeImportedRecipe(content, slug, item.file, {
    skipUniqueSlugCheck: true,
  })
  options.existing.bySlug.add(recipe.slug)
  options.usedSlugs.add(recipe.slug)
  if (recipe.original_url) {
    options.existing.bySourceUrl.set(sourceUrlKey(recipe.original_url), {
      bookmarked: recipe.bookmarked,
      notes: recipe.notes,
      original_url: recipe.original_url,
      servings: recipe.servings,
      slug: recipe.slug,
      tags: recipe.tags,
      title: recipe.title,
    })
  }
  return { ...item, savedSlug: recipe.slug, status: 'saved' }
}

function allocateUniqueSlug(
  baseSlug: string,
  existingSlugs: Set<string>,
  usedSlugs: Set<string>
): string {
  let slug = baseSlug
  let counter = 2
  while (existingSlugs.has(slug) || usedSlugs.has(slug)) {
    slug = `${baseSlug}-${counter}`
    counter += 1
  }
  return slug
}

export async function loadExistingIndex(): Promise<BulkExistingIndex> {
  const recipes = await getRecipes('')
  const bySlug = new Set(recipes.map(recipe => recipe.slug))
  const bySourceUrl = new Map<string, RecipeSummary>()
  for (const recipe of recipes) {
    if (!recipe.original_url) {
      continue
    }
    bySourceUrl.set(sourceUrlKey(recipe.original_url), recipe)
  }
  return { bySlug, bySourceUrl }
}

export function markItemsReadyIgnoringUnmatched(items: BulkImportItem[]): BulkImportItem[] {
  return items.map(item => {
    if (item.status !== 'pending') {
      return item
    }
    return { ...item, status: 'ready', unmatchedNames: [] }
  })
}

export function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    name.endsWith('.zip')
  )
}

export function isSupportedBulkImportFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    file.type.startsWith('image/') ||
    name.endsWith('.pdf') ||
    name.endsWith('.docx') ||
    name.endsWith('.txt') ||
    name.endsWith('.html') ||
    name.endsWith('.htm') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown')
  )
}

export function isBulkImportSelectionFile(file: File): boolean {
  return isSupportedBulkImportFile(file) || isZipFile(file)
}

export async function normalizeBulkImportSelection(files: File[]): Promise<File[]> {
  const expanded: File[] = []
  for (const file of files) {
    if (isZipFile(file)) {
      expanded.push(...(await expandZipToRecipeFiles(file)))
      continue
    }
    if (isSupportedBulkImportFile(file)) {
      expanded.push(file)
    }
  }
  return dedupeBulkFiles(expanded)
}

async function expandZipToRecipeFiles(zipFile: File): Promise<File[]> {
  const { unzip } = await import('fflate')
  const bytes = new Uint8Array(await zipFile.arrayBuffer())
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (error, result) => {
      if (error) {
        reject(error)
        return
      }
      resolve(result)
    })
  })

  const files: File[] = []
  for (const [path, content] of Object.entries(entries)) {
    if (!content.length || path.endsWith('/')) {
      continue
    }
    const baseName = path.split('/').pop() ?? path
    if (baseName.startsWith('.') || path.includes('__MACOSX/')) {
      continue
    }
    const file = new File([content.slice()], baseName, {
      lastModified: Date.now(),
      type: guessMimeType(baseName),
    })
    if (isSupportedBulkImportFile(file)) {
      files.push(file)
    }
  }
  return files
}

function dedupeBulkFiles(files: File[]): File[] {
  const seen = new Set<string>()
  const unique: File[] = []
  for (const file of files) {
    const key = `${file.name.toLowerCase()}|${file.size}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(file)
  }
  return unique.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  )
}

function guessMimeType(fileName: string): string {
  const name = fileName.toLowerCase()
  if (name.endsWith('.pdf')) {
    return 'application/pdf'
  }
  if (name.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    return 'text/html'
  }
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')) {
    return 'text/plain'
  }
  if (name.endsWith('.png')) {
    return 'image/png'
  }
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (name.endsWith('.webp')) {
    return 'image/webp'
  }
  if (name.endsWith('.gif')) {
    return 'image/gif'
  }
  return ''
}
