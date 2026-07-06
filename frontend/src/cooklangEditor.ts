import type { JSONContent } from '@tiptap/core'

import { extractTokens, serializeIngredient, type IngredientAttrs } from './cooklangTokens'

const SECTION_LINE_RE = /^=+\s*(.+?)\s*=+\s*$/
const NOTE_LINE_RE = /^>\s?(.*)$/

export function parseCooklangBody(body: string): JSONContent {
  const lines = body.split('\n')
  return {
    type: 'doc',
    content: lines.map(parseCooklangLine),
  }
}

export function serializeCooklangBody(doc: JSONContent): string {
  const blocks = doc.content ?? []
  return blocks.map(serializeBlock).join('\n')
}

function parseCooklangLine(line: string): JSONContent {
  const sectionMatch = line.match(SECTION_LINE_RE)
  if (sectionMatch) {
    const title = sectionMatch[1].trim()
    return title
      ? { type: 'section', content: [{ type: 'text', text: title }] }
      : { type: 'section' }
  }

  const noteMatch = line.match(NOTE_LINE_RE)
  if (noteMatch) {
    const text = noteMatch[1]
    return text ? { type: 'cookNote', content: [{ type: 'text', text }] } : { type: 'cookNote' }
  }

  const content = parseLineContent(line)
  return content ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function parseLineContent(line: string): JSONContent[] | undefined {
  const tokens = extractTokens(line)
  if (!tokens.length && !line) {
    return undefined
  }

  const content: JSONContent[] = []
  let cursor = 0
  for (const token of tokens) {
    if (token.start > cursor) {
      content.push({ type: 'text', text: line.slice(cursor, token.start) })
    }
    content.push({
      type: 'ingredient',
      attrs: {
        fixed: token.fixed,
        name: token.name,
        note: token.note,
        quantity: token.quantity,
        unit: token.unit,
      } satisfies IngredientAttrs,
    })
    cursor = token.end
  }
  if (cursor < line.length) {
    content.push({ type: 'text', text: line.slice(cursor) })
  }
  return content.length ? content : undefined
}

function serializeBlock(block: JSONContent): string {
  if (block.type === 'section') {
    return `==${serializeInlineContent(block.content)}==`
  }
  if (block.type === 'cookNote') {
    const text = serializeInlineContent(block.content)
    return text ? `> ${text}` : '>'
  }
  return serializeParagraph(block)
}

function serializeInlineContent(content: JSONContent[] | undefined): string {
  if (!content?.length) {
    return ''
  }
  return content
    .map(node => {
      if (node.type === 'text') {
        return node.text ?? ''
      }
      if (node.type === 'hardBreak') {
        return '\n'
      }
      return ''
    })
    .join('')
}

function serializeParagraph(paragraph: JSONContent): string {
  if (!paragraph.content?.length) {
    return ''
  }
  return paragraph.content
    .map(node => {
      if (node.type === 'text') {
        return node.text ?? ''
      }
      if (node.type === 'ingredient') {
        return serializeIngredient({
          fixed: Boolean(node.attrs?.fixed),
          name: String(node.attrs?.name ?? ''),
          note: String(node.attrs?.note ?? ''),
          quantity: String(node.attrs?.quantity ?? ''),
          unit: String(node.attrs?.unit ?? ''),
        })
      }
      if (node.type === 'hardBreak') {
        return '\n'
      }
      return ''
    })
    .join('')
}
