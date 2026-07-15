import { COOKLANG_TOKEN_CHARS } from './cooklangTokens'

export const COOKWARE_TOKEN_RE = new RegExp(
  `#(?:([${COOKLANG_TOKEN_CHARS}]+?)\\{\\}|([${COOKLANG_TOKEN_CHARS}]+?)(?=\\s|[.,;:!?)]|$))`,
  'g',
)

export interface CookwareAttrs {
  name: string
}

export interface CookwareToken extends CookwareAttrs {
  end: number
  full: string
  start: number
}

export function extractCookwareTokens(body: string): CookwareToken[] {
  const tokens: CookwareToken[] = []
  const pattern = new RegExp(COOKWARE_TOKEN_RE.source, 'g')
  for (const match of body.matchAll(pattern)) {
    const full = match[0]
    const start = match.index ?? 0
    const name = (match[1] || match[2] || '').trim()
    if (!name) {
      continue
    }
    tokens.push({
      end: start + full.length,
      full,
      name,
      start,
    })
  }
  return tokens
}

export function serializeCookware(attrs: CookwareAttrs): string {
  const name = attrs.name.trim()
  return `#${name}{}`
}
