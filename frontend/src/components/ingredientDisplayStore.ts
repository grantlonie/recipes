import type { IngredientAttrs } from '../cooklangTokens'

export interface IngredientDisplayState {
  onEditIngredient: (pos: number, attrs: IngredientAttrs) => void
}

const listeners = new Set<() => void>()

let state: IngredientDisplayState = {
  onEditIngredient: () => undefined,
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
