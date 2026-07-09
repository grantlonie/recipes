import type {
  AssetUploadResponse,
  AuthState,
  CatalogIngredient,
  ImportPreview,
  IngredientCatalog,
  RecipeDetail,
  RecipeMetadataInput,
  RecipeSummary,
  SearchResult,
  SyncManifest,
} from './types'

export async function createRecipe(slug: string, content: string): Promise<RecipeDetail> {
  return request('/api/recipes', {
    body: JSON.stringify({ content, slug }),
    method: 'POST',
  })
}

export async function deleteRecipe(slug: string): Promise<void> {
  return request(`/api/recipes/${slug}`, { method: 'DELETE' })
}

export async function getSyncManifest(): Promise<SyncManifest> {
  return request('/api/sync/manifest')
}

export async function getSyncRecipes(): Promise<RecipeDetail[]> {
  return request('/api/sync/recipes')
}

export async function getAuthState(): Promise<AuthState> {
  return request('/api/auth/me')
}

export async function getRecipe(slug: string): Promise<RecipeDetail> {
  return request(`/api/recipes/${slug}`)
}

export async function getRecipes(query: string): Promise<RecipeSummary[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : ''
  const data = await request<RecipeSummary[] | SearchResult[]>(`/api/recipes${params}`)
  if (!query) {
    return data as RecipeSummary[]
  }
  return (data as SearchResult[]).map(result => result.recipe)
}

export async function getScaledRecipe(slug: string, servings: number): Promise<RecipeDetail> {
  return request(`/api/recipe-scale/${slug}?servings=${servings}`)
}

export async function getTags(): Promise<string[]> {
  return request('/api/tags')
}

export async function getIngredientCatalog(): Promise<IngredientCatalog> {
  return request('/api/ingredients')
}

export async function upsertIngredient(ingredient: CatalogIngredient): Promise<CatalogIngredient> {
  return request('/api/ingredients', {
    body: JSON.stringify(ingredient),
    method: 'PUT',
  })
}

export async function deleteIngredient(name: string): Promise<void> {
  return request(`/api/ingredients/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function importRecipe(url: string): Promise<ImportPreview> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 100_000)

  try {
    return await request('/api/import', {
      body: JSON.stringify({ url }),
      method: 'POST',
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        "Couldn't import this recipe. The URL may not be a supported recipe page, or the import timed out.",
      )
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function importRecipeFile(slug: string): Promise<ImportPreview> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 100_000)

  try {
    return await request('/api/import/file', {
      body: JSON.stringify({ slug }),
      method: 'POST',
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error("Couldn't import this recipe. The import timed out.")
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function importRecipeUpload(file: File): Promise<ImportPreview> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 100_000)
  const formData = new FormData()
  formData.append('file', file)

  try {
    const response = await fetch('/api/import/upload', {
      body: formData,
      cache: 'no-store',
      credentials: 'include',
      method: 'POST',
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(String(detail.detail ?? response.statusText))
    }
    return response.json() as Promise<ImportPreview>
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error("Couldn't import this recipe. The import timed out.")
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function uploadRecipeSource(slug: string, file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await uploadRequest(`/api/recipes/${encodeURIComponent(slug)}/source`, formData)
  return response.path
}

export async function uploadRecipeImage(slug: string, file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await uploadRequest(`/api/recipes/${encodeURIComponent(slug)}/image`, formData)
  return response.path
}

export async function login(username: string, password: string): Promise<AuthState> {
  return request('/api/auth/login', {
    body: JSON.stringify({ password, username }),
    method: 'POST',
  })
}

export async function logout(): Promise<AuthState> {
  return request('/api/auth/logout', { method: 'POST' })
}

export async function updateRecipe(slug: string, content: string): Promise<RecipeDetail> {
  return request(`/api/recipes/${slug}`, {
    body: JSON.stringify({ content }),
    method: 'PUT',
  })
}

export async function updateRecipeMetadata(
  slug: string,
  input: RecipeMetadataInput
): Promise<RecipeDetail> {
  return request(`/api/recipes/${slug}/metadata`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  })
}

async function uploadRequest(url: string, body: FormData): Promise<AssetUploadResponse> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    method: 'POST',
    body,
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(String(detail.detail ?? response.statusText))
  }

  return response.json() as Promise<AssetUploadResponse>
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    ...init,
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(String(detail.detail ?? response.statusText))
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}
