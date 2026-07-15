import type { JSONContent } from '@tiptap/core'

import { extractTokens, serializeIngredient, type IngredientAttrs } from './cooklangTokens'
import { extractTimerTokens, serializeTimer, type TimerAttrs } from './cooklangTimers'
import type { RecipeBlock, RecipeDetail } from './types'

const SECTION_LINE_RE = /^=+\s*(.+?)\s*=+\s*$/
const NOTE_LINE_RE = /^>\s?(.*)$/
const FRONT_MATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n?/

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

export function parseRecipeBlocks(body: string): RecipeBlock[] {
  const blocks: RecipeBlock[] = []
  for (const block of body.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n')
    let index = 0
    while (index < lines.length) {
      const stripped = lines[index].trim()
      if (!stripped) {
        index += 1
        continue
      }
      const noteMatch = stripped.match(NOTE_LINE_RE)
      if (noteMatch) {
        blocks.push({ kind: 'note', text: noteMatch[1].trim() })
        index += 1
        continue
      }
      const sectionMatch = stripped.match(SECTION_LINE_RE)
      if (sectionMatch) {
        blocks.push({ kind: 'section', title: sectionMatch[1].trim() })
        index += 1
        continue
      }
      const stepLines: string[] = []
      while (index < lines.length) {
        const line = lines[index].trim()
        if (!line) {
          index += 1
          continue
        }
        if (SECTION_LINE_RE.test(line) || NOTE_LINE_RE.test(line)) {
          break
        }
        stepLines.push(lines[index])
        index += 1
      }
      if (stepLines.length) {
        blocks.push({ kind: 'step', text: stepLines.join('\n').trim() })
      }
    }
  }
  return blocks
}

export function getRecipeBlocks(recipe: RecipeDetail & { steps?: string[] }): RecipeBlock[] {
  if (recipe.blocks != null) {
    return recipe.blocks
  }
  if (recipe.steps?.length) {
    return recipe.steps.flatMap(text => parseRecipeBlocks(text))
  }
  if (recipe.content) {
    return parseRecipeBlocks(recipe.content.replace(FRONT_MATTER_RE, '').trimStart())
  }
  return []
}

function parseCooklangLine(line: string): JSONContent {
  const sectionMatch = line.match(SECTION_LINE_RE)
  if (sectionMatch) {
    return { type: 'section', attrs: { title: sectionMatch[1].trim() } }
  }

  const noteMatch = line.match(NOTE_LINE_RE)
  if (noteMatch) {
    const text = noteMatch[1]
    return text ? { type: 'cookNote', content: [{ type: 'text', text }] } : { type: 'cookNote' }
  }

  const content = parseLineContent(line)
  return content ? { type: 'paragraph', content } : { type: 'paragraph' }
}

type InlineMarker =
  | { end: number; kind: 'ingredient'; start: number; attrs: IngredientAttrs }
  | { end: number; kind: 'timer'; start: number; attrs: TimerAttrs }

function parseLineContent(line: string): JSONContent[] | undefined {
  const markers = collectInlineMarkers(line)
  if (!markers.length && !line) {
    return undefined
  }

  const content: JSONContent[] = []
  let cursor = 0
  for (const marker of markers) {
    if (marker.start < cursor) {
      continue
    }
    if (marker.start > cursor) {
      content.push({ type: 'text', text: line.slice(cursor, marker.start) })
    }
    if (marker.kind === 'ingredient') {
      content.push({ type: 'ingredient', attrs: marker.attrs })
    } else {
      content.push({ type: 'timer', attrs: marker.attrs })
    }
    cursor = marker.end
  }
  if (cursor < line.length) {
    content.push({ type: 'text', text: line.slice(cursor) })
  }
  return content.length ? content : undefined
}

function collectInlineMarkers(line: string): InlineMarker[] {
  const markers: InlineMarker[] = []
  for (const token of extractTokens(line)) {
    markers.push({
      attrs: {
        fixed: token.fixed,
        name: token.name,
        note: token.note,
        quantity: token.quantity,
        unit: token.unit,
      },
      end: token.end,
      kind: 'ingredient',
      start: token.start,
    })
  }
  for (const token of extractTimerTokens(line)) {
    markers.push({
      attrs: {
        name: token.name,
        quantity: token.quantity,
        unit: token.unit,
      },
      end: token.end,
      kind: 'timer',
      start: token.start,
    })
  }
  markers.sort((left, right) => left.start - right.start)
  return markers
}

function serializeBlock(block: JSONContent): string {
  if (block.type === 'section') {
    const title = String(block.attrs?.title ?? '').trim() || serializeInlineContent(block.content)
    return `==${title}==`
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
      if (node.type === 'timer') {
        return serializeTimer({
          name: String(node.attrs?.name ?? ''),
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
