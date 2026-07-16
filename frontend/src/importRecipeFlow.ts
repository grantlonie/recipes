import {
  createRecipe,
  importRecipe,
  importRecipeUpload,
  updateRecipe,
  uploadRecipeSource,
} from './api'
import {
  autofillMappingDensities,
  buildMappedImportContent,
  buildMappingRows,
  parseImportedDocument,
  renderImportDocument,
  type MappingRow,
  type PendingImport,
} from './importMapping'
import { ensureUniqueSlug, findRecipeBySourceUrl, formatImportError } from './shareImport'
import { storeRecipe } from './sync'
import type { CatalogIngredient, ImportPreview, RecipeDetail, RecipeSummary } from './types'

export type RecipeImportResult =
  | { kind: 'existing'; recipe: RecipeSummary }
  | { kind: 'preview'; preview: ImportPreview; sourceFile?: File }

export interface PreparedImportMapping {
  mappingRows: MappingRow[]
  pendingImport: PendingImport
  preview: ImportPreview
  sourceFile?: File
}

export async function importRecipeFromUrl(url: string): Promise<RecipeImportResult> {
  const recipeUrl = url.trim()
  const existing = await findRecipeBySourceUrl(recipeUrl)
  if (existing) {
    return { kind: 'existing', recipe: existing }
  }

  const preview = await importRecipe(recipeUrl)
  return { kind: 'preview', preview }
}

export async function importRecipeFromFile(file: File): Promise<RecipeImportResult> {
  const preview = await importRecipeUpload(file)
  return { kind: 'preview', preview, sourceFile: file }
}

export function prepareImportMapping(
  preview: ImportPreview,
  catalog: CatalogIngredient[],
  options: Omit<PendingImport, 'body' | 'metadata'> = {}
): PreparedImportMapping | null {
  const parsed = parseImportedDocument(preview.content)
  const unmatched = preview.unmatched_ingredients ?? []
  if (unmatched.length === 0) {
    return null
  }

  return {
    mappingRows: buildMappingRows(parsed.body, unmatched, catalog),
    pendingImport: {
      body: parsed.body,
      metadata: parsed.metadata,
      sourceContent: preview.content,
      suggestedSlug: preview.suggested_slug,
      ...options,
    },
    preview,
  }
}

export function scheduleMappingDensityAutofill(
  rows: MappingRow[],
  catalog: CatalogIngredient[],
  setRows: (updater: (current: MappingRow[]) => MappingRow[]) => void
) {
  void autofillMappingDensities(rows, catalog).then(filled => {
    const byKey = new Map(
      filled.map(row => [
        `${row.originalName.toLowerCase()}|${row.unit.toLowerCase()}`,
        row.createDensity,
      ])
    )
    setRows(current => {
      let changed = false
      const next = current.map(row => {
        if (row.createDensity.trim()) {
          return row
        }
        const density = byKey.get(`${row.originalName.toLowerCase()}|${row.unit.toLowerCase()}`)
        if (!density?.trim()) {
          return row
        }
        changed = true
        return { ...row, createDensity: density }
      })
      return changed ? next : current
    })
  })
}

export async function finalizeImportedRecipe(
  content: string,
  suggestedSlug: string,
  sourceFile?: File,
  options: { skipUniqueSlugCheck?: boolean } = {}
): Promise<RecipeDetail> {
  const slug = options.skipUniqueSlugCheck
    ? suggestedSlug.trim() || 'new-recipe'
    : await ensureUniqueSlug(suggestedSlug)
  let recipe = await createRecipe(slug, content)

  if (!sourceFile) {
    return recipe
  }

  const sourcePath = await uploadRecipeSource(slug, sourceFile)
  const nextContent = attachAssetsToContent(recipe.content, {
    image: sourceFile.type.startsWith('image/') ? sourcePath : undefined,
    source: sourcePath,
  })
  recipe = await updateRecipe(slug, nextContent)
  return recipe
}

export function buildImportContent(metadata: Record<string, unknown>, body: string): string {
  return renderImportDocument(metadata, body)
}

export function buildImportContentFromPending(pendingImport: PendingImport, body: string): string {
  return buildMappedImportContent(pendingImport, body)
}

export async function persistImportedRecipe(recipe: RecipeDetail, sync: () => Promise<void>) {
  try {
    await storeRecipe(recipe)
  } catch {
    // Recipe is already on the server; local cache is best-effort.
  }
  try {
    await sync()
  } catch {
    // Sync can retry later; don't fail the import after a successful create.
  }
}

export { formatImportError }

function attachAssetsToContent(
  content: string,
  assets: { image?: string; source: string }
): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) {
    return content
  }

  const parsed = parseImportedDocument(content)
  parsed.metadata.source = assets.source
  if (assets.image) {
    parsed.metadata.image = assets.image
  }

  return renderImportDocument(parsed.metadata, parsed.body)
}
