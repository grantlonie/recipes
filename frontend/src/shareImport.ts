import { getRecipes } from './api'

const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i

export function extractRecipeUrl(params: {
  text?: string | null
  url?: string | null
}): string | null {
  const directUrl = params.url?.trim()
  if (directUrl && isValidHttpUrl(directUrl)) {
    return directUrl
  }

  const text = params.text?.trim()
  if (!text) {
    return null
  }

  const match = text.match(URL_PATTERN)
  if (!match) {
    return null
  }

  return match[0].replace(/[.,;:!?)]+$/, '')
}

export function buildImportPath(url: string): string {
  return `/import?url=${encodeURIComponent(url)}`
}

export function buildLoginUrl(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`
}

export function getSafeReturnTo(value: string | null): string | null {
  if (!value) {
    return null
  }

  if (!value.startsWith('/') || value.startsWith('//')) {
    return null
  }

  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.origin !== window.location.origin) {
      return null
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

export async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  const normalized = baseSlug.trim() || 'new-recipe'
  const recipes = await getRecipes('')
  const existing = new Set(recipes.map(recipe => recipe.slug))

  if (!existing.has(normalized)) {
    return normalized
  }

  let counter = 2
  while (existing.has(`${normalized}-${counter}`)) {
    counter += 1
  }

  return `${normalized}-${counter}`
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
