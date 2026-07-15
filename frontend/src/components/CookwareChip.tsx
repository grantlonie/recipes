import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { useSyncExternalStore } from 'react'

import type { CookwareAttrs } from '../cooklangCookware'
import { stepCookwareMarkerClassName } from '../themeClasses'
import { getCookwareDisplayState, subscribeCookwareDisplay } from './cookwareDisplayStore'

export function CookwareChip({ getPos, node }: NodeViewProps) {
  const display = useSyncExternalStore(subscribeCookwareDisplay, getCookwareDisplayState)
  const attrs = node.attrs as CookwareAttrs
  const label = attrs.name.trim() || 'cookware'

  return (
    <NodeViewWrapper as="span" className="inline">
      <button
        className={`mx-0.5 ${stepCookwareMarkerClassName} hover:bg-stone-200 dark:hover:bg-stone-600`}
        contentEditable={false}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          const pos = getPos()
          if (typeof pos === 'number') {
            display.onEditCookware(pos, attrs)
          }
        }}
        type="button"
      >
        {label}
      </button>
    </NodeViewWrapper>
  )
}
