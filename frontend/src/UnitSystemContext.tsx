import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

import type { UnitSystem } from './types'

const UNIT_SYSTEM_KEY = 'recipes.unitSystem'
const PREFER_SMALL_SPOONS_KEY = 'recipes.preferSmallSpoons'

interface UnitSystemContextValue {
  preferSmallSpoons: boolean
  setPreferSmallSpoons: (value: boolean) => void
  setUnitSystem: (system: UnitSystem) => void
  unitSystem: UnitSystem
}

interface UnitSystemProviderProps {
  children: ReactNode
}

const UnitSystemContext = createContext<UnitSystemContextValue | null>(null)

export function UnitSystemProvider({ children }: UnitSystemProviderProps) {
  const [preferSmallSpoons, setPreferSmallSpoonsState] = useState(readPreferSmallSpoons)
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(readUnitSystem)

  const setPreferSmallSpoons = useCallback((value: boolean) => {
    window.localStorage.setItem(PREFER_SMALL_SPOONS_KEY, value ? 'true' : 'false')
    setPreferSmallSpoonsState(value)
  }, [])

  const setUnitSystem = useCallback((system: UnitSystem) => {
    window.localStorage.setItem(UNIT_SYSTEM_KEY, system)
    setUnitSystemState(system)
  }, [])

  const value = useMemo(
    () => ({
      preferSmallSpoons,
      setPreferSmallSpoons,
      setUnitSystem,
      unitSystem,
    }),
    [preferSmallSpoons, setPreferSmallSpoons, setUnitSystem, unitSystem]
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
  const stored = window.localStorage.getItem(UNIT_SYSTEM_KEY)
  if (stored === 'us' || stored === 'us_weight') {
    return stored
  }
  return 'metric'
}

function readPreferSmallSpoons(): boolean {
  return window.localStorage.getItem(PREFER_SMALL_SPOONS_KEY) === 'true'
}
