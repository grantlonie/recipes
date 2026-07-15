import type { TimerAttrs } from '../cooklangTimers'

export interface TimerDisplayState {
  onEditTimer: (pos: number, attrs: TimerAttrs) => void
}

const listeners = new Set<() => void>()

let state: TimerDisplayState = {
  onEditTimer: () => undefined,
}

export function getTimerDisplayState() {
  return state
}

export function setTimerDisplayState(next: TimerDisplayState) {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeTimerDisplay(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
