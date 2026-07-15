import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { useSyncExternalStore } from 'react'

import { formatTimerLabel, type TimerAttrs } from '../cooklangTimers'
import { stepTimerMarkerClassName } from '../themeClasses'
import { getTimerDisplayState, subscribeTimerDisplay } from './timerDisplayStore'

export function TimerChip({ getPos, node }: NodeViewProps) {
  const display = useSyncExternalStore(subscribeTimerDisplay, getTimerDisplayState)
  const attrs = node.attrs as TimerAttrs
  const label = formatTimerLabel(attrs)

  return (
    <NodeViewWrapper as="span" className="inline">
      <button
        className={`mx-0.5 ${stepTimerMarkerClassName} hover:bg-amber-100 dark:hover:bg-amber-900/50`}
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
