import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { useSyncExternalStore } from 'react'

import { formatTimerLabel, type TimerAttrs } from '../cooklangTimers'
import { getTimerDisplayState, subscribeTimerDisplay } from './timerDisplayStore'

export function TimerChip({ getPos, node }: NodeViewProps) {
  const display = useSyncExternalStore(subscribeTimerDisplay, getTimerDisplayState)
  const attrs = node.attrs as TimerAttrs
  const label = formatTimerLabel(attrs)

  return (
    <NodeViewWrapper as="span" className="inline">
      <button
        className="mx-0.5 my-0.5 inline rounded-md border border-amber-400 bg-amber-50/90 px-0.5 font-medium text-stone-900 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50"
        contentEditable={false}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          const pos = getPos()
          if (typeof pos === 'number') {
            display.onEditTimer(pos, attrs)
          }
        }}
        type="button"
      >
        {label}
      </button>
    </NodeViewWrapper>
  )
}
