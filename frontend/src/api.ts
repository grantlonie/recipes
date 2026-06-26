import type {
  AuthState,
  ImportPreview,
  RecipeDetail,
  RecipeMetadataInput,
  RecipeSummary,
  SearchResult,
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

export async function importRecipe(url: string): Promise<ImportPreview> {
  return request('/api/import', {
    body: JSON.stringify({ url }),
    method: 'POST',
  })
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

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
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
