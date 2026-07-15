import type { CookwareAttrs } from '../cooklangCookware'

export interface CookwareDisplayState {
  onEditCookware: (pos: number, attrs: CookwareAttrs) => void
}

const listeners = new Set<() => void>()

let state: CookwareDisplayState = {
  onEditCookware: () => undefined,
}

export function getCookwareDisplayState() {
  return state
}

export function setCookwareDisplayState(next: CookwareDisplayState) {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeCookwareDisplay(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
