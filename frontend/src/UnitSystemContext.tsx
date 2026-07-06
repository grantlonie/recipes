import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

import type { UnitSystem } from './types'

const STORAGE_KEY = 'recipes.unitSystem'

interface UnitSystemContextValue {
  setUnitSystem: (system: UnitSystem) => void
  unitSystem: UnitSystem
}

const UnitSystemContext = createContext<UnitSystemContextValue | null>(null)

export function UnitSystemProvider({ children }: { children: ReactNode }) {
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(readUnitSystem)

  const setUnitSystem = useCallback((system: UnitSystem) => {
    window.localStorage.setItem(STORAGE_KEY, system)
    setUnitSystemState(system)
  }, [])

  const value = useMemo(
    () => ({
      setUnitSystem,
      unitSystem,
    }),
    [setUnitSystem, unitSystem],
  )

  return <UnitSystemContext.Provider value={value}>{children}</UnitSystemContext.Provider>
}

export function useUnitSystem() {
  const value = useContext(UnitSystemContext)
  if (!value) {
    throw new Error('useUnitSystem must be used within UnitSystemProvider')
  }
  return value
}

function readUnitSystem(): UnitSystem {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'us' || stored === 'us_weight') {
    return stored
  }
  return 'metric'
}
