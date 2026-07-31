import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { useSyncExternalStore } from 'react'

import type { IngredientAttrs } from '../cooklangTokens'
import { formatIngredientLabel } from '../cooklangTokens'
import { formatQuantityDisplay } from '../quantities'
import { normalizeUnit } from '../units'
import { getIngredientDisplayState, subscribeIngredientDisplay } from './ingredientDisplayStore'

export function IngredientChip({ getPos, node }: NodeViewProps) {
  const display = useSyncExternalStore(subscribeIngredientDisplay, getIngredientDisplayState)
  const attrs = node.attrs as IngredientAttrs
  const label = formatChipLabel(attrs)

  return (
    <NodeViewWrapper as="span" className="inline">
      <button
        className="mx-0.5 my-0.5 inline-flex items-center rounded-full bg-orange-100 px-1 py-0 text-xs font-semibold text-orange-900 ring-1 ring-orange-200 hover:bg-orange-200 dark:bg-orange-950/60 dark:text-orange-200 dark:ring-orange-800 dark:hover:bg-orange-900/60"
        contentEditable={false}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          const pos = getPos()
          if (typeof pos === 'number') {
            display.onEditIngredient(pos, attrs)
          }
        }}
        type="button"
      >
        {label}
      </button>
    </NodeViewWrapper>
  )
}

function formatChipLabel(attrs: IngredientAttrs) {
  const quantity = attrs.quantity.trim() ? formatQuantityDisplay(attrs.quantity) : ''
  const unit = normalizeUnit(attrs.unit) ?? attrs.unit.trim()
  const amount = [quantity, unit].filter(Boolean).join(' ')
  const label = formatIngredientLabel(attrs.name, attrs.note)
  if (!amount) {
    return label
  }
  return `${amount} ${label}`
}
