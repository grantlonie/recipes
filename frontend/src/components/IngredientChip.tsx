import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { useSyncExternalStore } from 'react'

import type { IngredientAttrs } from '../cooklangTokens'
import { formatIngredientLabel } from '../cooklangTokens'
import type { CatalogIngredient, UnitSystem } from '../types'
import { densityForName, formatDisplayAmount, formatIngredientAmount } from '../units'
import {
  getIngredientDisplayState,
  subscribeIngredientDisplay,
} from './ingredientDisplayStore'

export function IngredientChip({ getPos, node }: NodeViewProps) {
  const display = useSyncExternalStore(subscribeIngredientDisplay, getIngredientDisplayState)
  const attrs = node.attrs as IngredientAttrs
  const label = formatChipLabel(attrs, display.catalog, display.unitSystem)

  return (
    <NodeViewWrapper as="span" className="inline">
      <button
        className="mx-0.5 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900 ring-1 ring-orange-200 hover:bg-orange-200"
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

function formatChipLabel(
  attrs: IngredientAttrs,
  catalog: CatalogIngredient[],
  unitSystem: UnitSystem,
) {
  const amount = formatIngredientAmount(attrs.quantity || null, attrs.unit || null, {
    densityKgM3: densityForName(attrs.name, catalog),
    unitSystem,
  })
  const formatted = formatDisplayAmount(amount)
  const label = formatIngredientLabel(attrs.name, attrs.note)
  if (!formatted) {
    return label
  }
  return `${formatted} ${label}`
}
