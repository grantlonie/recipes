import type {
  AuthState,
  Group,
  ImportPreview,
  RecipeDetail,
  RecipeSummary,
  SearchResult,
} from './types'

interface GroupInput {
  recipes: string[]
  title: string
}

export async function createGroup(input: GroupInput): Promise<Group> {
  return request('/api/groups', {
    body: JSON.stringify(input),
    method: 'POST',
  })
}

export async function createRecipe(slug: string, content: string): Promise<RecipeDetail> {
  return request('/api/recipes', {
    body: JSON.stringify({ content, slug }),
    method: 'POST',
  })
}

export async function getAuthState(): Promise<AuthState> {
  return request('/api/auth/me')
}

export async function getGroups(): Promise<Group[]> {
  return request('/api/groups')
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

export async function updateGroup(slug: string, input: GroupInput): Promise<Group> {
  return request(`/api/groups/${slug}`, {
    body: JSON.stringify(input),
    method: 'PUT',
  })
}

export async function updateRecipe(slug: string, content: string): Promise<RecipeDetail> {
  return request(`/api/recipes/${slug}`, {
    body: JSON.stringify({ content }),
    method: 'PUT',
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

  return response.json() as Promise<T>
}
