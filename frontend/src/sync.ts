import { getRecipe, getSyncManifest, getSyncRecipes } from './api'
import {
  deleteRecipes,
  getLocalManifest,
  getLocalRecipe,
  getStoredUpdatedAt,
  putRecipe,
  putRecipes,
  putRecipesDelta,
  setManifest,
} from './db'
import type { RecipeDetail } from './types'

export async function runSync(): Promise<void> {
  const manifest = await getSyncManifest()
  const localManifest = await getLocalManifest()

  if (!localManifest || localManifest.recipes.length === 0) {
    const recipes = await getSyncRecipes()
    await putRecipes(recipes, manifest)
    return
  }

  if (localManifest.version === manifest.version) {
    return
  }

  const serverBySlug = new Map(manifest.recipes.map(entry => [entry.slug, entry.updated_at]))
  const localBySlug = new Map(localManifest.recipes.map(entry => [entry.slug, entry.updated_at]))

  const toDelete = [...localBySlug.keys()].filter(slug => !serverBySlug.has(slug))
  await deleteRecipes(toDelete)

  const toFetch = [...serverBySlug.entries()]
    .filter(([slug, updatedAt]) => localBySlug.get(slug) !== updatedAt)
    .map(([slug]) => slug)

  if (!toFetch.length) {
    await setManifest(manifest)
    return
  }

  const fetched = await Promise.all(toFetch.map(slug => getRecipe(slug)))
  await putRecipesDelta(fetched, manifest)
}

export async function loadRecipeLocal(slug: string): Promise<RecipeDetail | null> {
  return getLocalRecipe(slug)
}

export async function fetchRecipeFresh(slug: string): Promise<RecipeDetail> {
  const manifest = await getSyncManifest()
  const entry = manifest.recipes.find(recipe => recipe.slug === slug)
  if (!entry) {
    throw new Error('Recipe not found')
  }

  const remote = await getRecipe(slug)
  await putRecipe(remote, entry.updated_at)
  return remote
}

export async function revalidateRecipe(slug: string): Promise<RecipeDetail | null> {
  try {
    const manifest = await getSyncManifest()
    const entry = manifest.recipes.find(recipe => recipe.slug === slug)
    if (!entry) {
      return null
    }

    const storedUpdatedAt = await getStoredUpdatedAt(slug)
    if (storedUpdatedAt === entry.updated_at) {
      return null
    }

    const remote = await getRecipe(slug)
    await putRecipe(remote, entry.updated_at)
    return remote
  } catch {
    return null
  }
}

export async function loadRecipeStaleFirst(
  slug: string,
  onUpdated?: (recipe: RecipeDetail) => void,
): Promise<RecipeDetail> {
  const local = await loadRecipeLocal(slug)
  if (local) {
    void revalidateRecipe(slug).then(updated => {
      if (updated) {
        onUpdated?.(updated)
      }
    })
    return local
  }

  return fetchRecipeFresh(slug)
}

export async function ensureRecipe(slug: string): Promise<RecipeDetail> {
  const local = await loadRecipeLocal(slug)
  const updated = await revalidateRecipe(slug)
  if (updated) {
    return updated
  }
  if (local) {
    return local
  }
  return fetchRecipeFresh(slug)
}

export async function storeRecipe(recipe: RecipeDetail, updatedAt?: string): Promise<void> {
  const manifest = await getSyncManifest()
  const entry = manifest.recipes.find(item => item.slug === recipe.slug)
  const timestamp = updatedAt ?? entry?.updated_at ?? new Date().toISOString()
  await putRecipe(recipe, timestamp)
  await setManifest(manifest)
}
