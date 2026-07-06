import { getRecipes } from './api'
import type { RecipeSummary } from './types'

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

export function formatImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Import failed'

  if (message.includes('Could not start recipe import')) {
    return "Couldn't import this recipe. The URL doesn't look like a supported recipe page."
  }

  if (message.includes('timed out') || message.includes('timed out waiting')) {
    return "Couldn't import this recipe. It took too long — the URL may not be supported."
  }

  if (message.includes('returned empty content')) {
    return "Couldn't import this recipe. No recipe content was found at that URL."
  }

  if (message.startsWith("Couldn't import this recipe")) {
    return message
  }

  return `Couldn't import this recipe. ${message}`
}

interface ImportSession {
  at: number
  status: 'done'
}

export function clearImportSession(url: string): void {
  sessionStorage.removeItem(importSessionKey(url))
}

export function getImportSession(url: string): ImportSession | null {
  const raw = sessionStorage.getItem(importSessionKey(url))
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as ImportSession
  } catch {
    clearImportSession(url)
    return null
  }
}

export function markImportDone(url: string): void {
  sessionStorage.setItem(
    importSessionKey(url),
    JSON.stringify({ at: Date.now(), status: 'done' } satisfies ImportSession),
  )
}

function importSessionKey(url: string): string {
  return `share-import:${url}`
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

export async function findRecipeBySourceUrl(url: string): Promise<RecipeSummary | null> {
  const targetKey = sourceUrlKey(url)
  const recipes = await getRecipes('')

  return (
    recipes.find(recipe => recipe.original_url && sourceUrlKey(recipe.original_url) === targetKey) ??
    null
  )
}

export function canonicalSourceUrl(url: string): string {
  try {
    const parsed = new URL(url.trim())
    const hostname = parsed.hostname.toLowerCase()

    if (hostname.endsWith('google.com') && parsed.pathname.startsWith('/amp/s/')) {
      let path = parsed.pathname.slice('/amp/s/'.length)
      if (path.endsWith('/amp')) {
        path = path.slice(0, -'/amp'.length)
      }
      return `https://${path}`
    }

    parsed.hash = ''
    parsed.hostname = hostname

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1)
    }

    return parsed.toString()
  } catch {
    return url.trim()
  }
}

export function sourceUrlKey(url: string): string {
  try {
    const parsed = new URL(canonicalSourceUrl(url))
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    let path = parsed.pathname
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1)
    }

    return `${host}${path}${parsed.search}`
  } catch {
    return canonicalSourceUrl(url).toLowerCase()
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
