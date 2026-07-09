import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { useSyncExternalStore } from 'react'

import { getSectionDisplayState, subscribeSectionDisplay } from './sectionDisplayStore'

export function SectionChip({ getPos, node, selected }: NodeViewProps) {
  const display = useSyncExternalStore(subscribeSectionDisplay, getSectionDisplayState)
  const title = String(node.attrs.title ?? '').trim()

  return (
    <NodeViewWrapper as="div">
      <button
        className={`inline cursor-pointer border-0 bg-transparent p-0 text-sm font-bold uppercase tracking-wide text-orange-800 hover:underline ${
          selected ? 'underline decoration-orange-400 decoration-2' : ''
        }`}
        contentEditable={false}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          const pos = getPos()
          if (typeof pos === 'number') {
            display.onEditSection(pos, title)
          }
        }}
        type="button"
      >
        {title || 'Untitled section'}
      </button>
    </NodeViewWrapper>
  )
}
