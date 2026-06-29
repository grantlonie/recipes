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

export async function ensureRecipe(slug: string): Promise<RecipeDetail> {
  const local = await getLocalRecipe(slug)

  try {
    const manifest = await getSyncManifest()
    const entry = manifest.recipes.find(recipe => recipe.slug === slug)
    if (!entry) {
      if (local) {
        return local
      }
      throw new Error('Recipe not found')
    }

    const storedUpdatedAt = await getStoredUpdatedAt(slug)
    if (local && storedUpdatedAt === entry.updated_at) {
      return local
    }

    const remote = await getRecipe(slug)
    await putRecipe(remote, entry.updated_at)
    return remote
  } catch (error) {
    if (local) {
      return local
    }
    throw error
  }
}

export async function storeRecipe(recipe: RecipeDetail, updatedAt?: string): Promise<void> {
  await putRecipe(recipe, updatedAt ?? new Date().toISOString())
}
