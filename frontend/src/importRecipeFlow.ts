import {
  createRecipe,
  importRecipe,
  importRecipeUpload,
  updateRecipe,
  uploadRecipeSource,
} from './api'
import {
  buildMappingRows,
  parseImportedDocument,
  renderImportDocument,
  type PendingImport,
} from './importMapping'
import { ensureUniqueSlug, findRecipeBySourceUrl, formatImportError } from './shareImport'
import { storeRecipe } from './sync'
import type { CatalogIngredient, ImportPreview, RecipeDetail, RecipeSummary } from './types'

export type RecipeImportResult =
  | { kind: 'existing'; recipe: RecipeSummary }
  | { kind: 'preview'; preview: ImportPreview; sourceFile?: File }

export interface PreparedImportMapping {
  mappingRows: ReturnType<typeof buildMappingRows>
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
      suggestedSlug: preview.suggested_slug,
      ...options,
    },
    preview,
  }
}

export async function finalizeImportedRecipe(
  content: string,
  suggestedSlug: string,
  sourceFile?: File
): Promise<RecipeDetail> {
  const slug = await ensureUniqueSlug(suggestedSlug)
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

export async function persistImportedRecipe(recipe: RecipeDetail, sync: () => Promise<void>) {
  await storeRecipe(recipe)
  await sync()
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
