import type { IngredientCatalog, RecipeDetail, RecipeSummary, SyncManifest } from './types'

const DB_NAME = 'recipes-app'
const DB_VERSION = 2
const RECIPES_STORE = 'recipes'
const META_STORE = 'meta'
const MANIFEST_KEY = 'manifest'
const INGREDIENTS_KEY = 'ingredients'

export interface StoredRecipe {
  slug: string
  recipe: RecipeDetail
  updatedAt: string
}

export async function countRecipes(): Promise<number> {
  const db = await openDb()
  const transaction = db.transaction(RECIPES_STORE, 'readonly')
  const count = await requestToPromise(transaction.objectStore(RECIPES_STORE).count())
  db.close()
  return count
}

export async function getLocalManifest(): Promise<SyncManifest | null> {
  const db = await openDb()
  const transaction = db.transaction(META_STORE, 'readonly')
  const manifest = await requestToPromise(transaction.objectStore(META_STORE).get(MANIFEST_KEY))
  db.close()
  return (manifest as SyncManifest | undefined) ?? null
}

export async function getLocalRecipe(slug: string): Promise<RecipeDetail | null> {
  const db = await openDb()
  const transaction = db.transaction(RECIPES_STORE, 'readonly')
  const stored = await requestToPromise(transaction.objectStore(RECIPES_STORE).get(slug))
  db.close()
  return (stored as StoredRecipe | undefined)?.recipe ?? null
}

export async function getStoredUpdatedAt(slug: string): Promise<string | null> {
  const db = await openDb()
  const transaction = db.transaction(RECIPES_STORE, 'readonly')
  const stored = await requestToPromise(transaction.objectStore(RECIPES_STORE).get(slug))
  db.close()
  return (stored as StoredRecipe | undefined)?.updatedAt ?? null
}

export async function getAllStoredRecipes(): Promise<StoredRecipe[]> {
  const db = await openDb()
  const transaction = db.transaction(RECIPES_STORE, 'readonly')
  const stored = await requestToPromise(transaction.objectStore(RECIPES_STORE).getAll())
  db.close()
  return stored as StoredRecipe[]
}

export async function getLocalSummaries(): Promise<RecipeSummary[]> {
  const stored = await getAllStoredRecipes()
  return stored
    .map(record => summaryFromDetail(record.recipe))
    .sort((left, right) =>
      left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    )
}

export async function getLocalTags(): Promise<string[]> {
  const stored = await getAllStoredRecipes()
  const tags = new Set<string>()
  for (const record of stored) {
    for (const tag of record.recipe.tags) {
      tags.add(tag)
    }
  }
  return [...tags].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  )
}

export async function putRecipe(recipe: RecipeDetail, updatedAt: string): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction(RECIPES_STORE, 'readwrite')
  transaction.objectStore(RECIPES_STORE).put({ recipe, slug: recipe.slug, updatedAt })
  await transactionDone(transaction)
  db.close()
}

export async function putRecipes(recipes: RecipeDetail[], manifest: SyncManifest): Promise<void> {
  const updatedAtBySlug = new Map(manifest.recipes.map(entry => [entry.slug, entry.updated_at]))
  const db = await openDb()
  const recipeTransaction = db.transaction(RECIPES_STORE, 'readwrite')
  const store = recipeTransaction.objectStore(RECIPES_STORE)
  store.clear()
  for (const recipe of recipes) {
    store.put({
      recipe,
      slug: recipe.slug,
      updatedAt: updatedAtBySlug.get(recipe.slug) ?? new Date().toISOString(),
    })
  }
  await transactionDone(recipeTransaction)

  const metaTransaction = db.transaction(META_STORE, 'readwrite')
  metaTransaction.objectStore(META_STORE).put(manifest, MANIFEST_KEY)
  await transactionDone(metaTransaction)
  db.close()
}

export async function putRecipesDelta(
  recipes: RecipeDetail[],
  manifest: SyncManifest
): Promise<void> {
  const updatedAtBySlug = new Map(manifest.recipes.map(entry => [entry.slug, entry.updated_at]))
  const db = await openDb()
  const recipeTransaction = db.transaction(RECIPES_STORE, 'readwrite')
  const store = recipeTransaction.objectStore(RECIPES_STORE)
  for (const recipe of recipes) {
    store.put({
      recipe,
      slug: recipe.slug,
      updatedAt: updatedAtBySlug.get(recipe.slug) ?? new Date().toISOString(),
    })
  }
  await transactionDone(recipeTransaction)

  const metaTransaction = db.transaction(META_STORE, 'readwrite')
  metaTransaction.objectStore(META_STORE).put(manifest, MANIFEST_KEY)
  await transactionDone(metaTransaction)
  db.close()
}

export async function deleteRecipes(slugs: string[]): Promise<void> {
  if (!slugs.length) {
    return
  }

  const db = await openDb()
  const transaction = db.transaction(RECIPES_STORE, 'readwrite')
  const store = transaction.objectStore(RECIPES_STORE)
  for (const slug of slugs) {
    store.delete(slug)
  }
  await transactionDone(transaction)
  db.close()
}

export async function setManifest(manifest: SyncManifest): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction(META_STORE, 'readwrite')
  transaction.objectStore(META_STORE).put(manifest, MANIFEST_KEY)
  await transactionDone(transaction)
  db.close()
}

export async function getLocalIngredientCatalog(): Promise<IngredientCatalog | null> {
  const db = await openDb()
  const transaction = db.transaction(META_STORE, 'readonly')
  const catalog = await requestToPromise(transaction.objectStore(META_STORE).get(INGREDIENTS_KEY))
  db.close()
  return (catalog as IngredientCatalog | undefined) ?? null
}

export async function putIngredientCatalog(catalog: IngredientCatalog): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction(META_STORE, 'readwrite')
  transaction.objectStore(META_STORE).put(catalog, INGREDIENTS_KEY)
  await transactionDone(transaction)
  db.close()
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECIPES_STORE)) {
        db.createObjectStore(RECIPES_STORE, { keyPath: 'slug' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function summaryFromDetail(recipe: RecipeDetail): RecipeSummary {
  return {
    bookmarked: recipe.bookmarked,
    cook_time: recipe.cook_time,
    image: recipe.image,
    notes: recipe.notes,
    original_url: recipe.original_url,
    servings: recipe.servings,
    slug: recipe.slug,
    tags: recipe.tags,
    title: recipe.title,
  }
}
