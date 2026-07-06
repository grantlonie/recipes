import type { IngredientAttrs } from '../cooklangTokens'
import type { CatalogIngredient, UnitSystem } from '../types'

export interface IngredientDisplayState {
  catalog: CatalogIngredient[]
  onEditIngredient: (pos: number, attrs: IngredientAttrs) => void
  unitSystem: UnitSystem
}

const listeners = new Set<() => void>()

let state: IngredientDisplayState = {
  catalog: [],
  onEditIngredient: () => undefined,
  unitSystem: 'metric',
}

export function getIngredientDisplayState() {
  return state
}

export function setIngredientDisplayState(next: IngredientDisplayState) {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeIngredientDisplay(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
