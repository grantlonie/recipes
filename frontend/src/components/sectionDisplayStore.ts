export interface SectionDisplayState {
  onEditSection: (pos: number, title: string) => void
}

const listeners = new Set<() => void>()

let state: SectionDisplayState = {
  onEditSection: () => undefined,
}

export function getSectionDisplayState() {
  return state
}

export function setSectionDisplayState(next: SectionDisplayState) {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeSectionDisplay(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
