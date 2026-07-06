import type { ChangeEvent } from 'react'

import { useUnitSystem } from '../UnitSystemContext'
import type { UnitSystem } from '../types'

const OPTIONS: { label: string; value: UnitSystem }[] = [
  { label: 'Metric', value: 'metric' },
  { label: 'Cups', value: 'us' },
  { label: 'lb·oz', value: 'us_weight' },
]

export function UnitSystemToggle() {
  const { setUnitSystem, unitSystem } = useUnitSystem()

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    setUnitSystem(event.target.value as UnitSystem)
  }

  return (
    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600">
      <span className="sr-only">Unit system</span>
      <select
        aria-label="Unit system"
        className="cursor-pointer border-0 bg-transparent py-0.5 pl-1 pr-0 text-xs font-semibold text-orange-600 focus:outline-none focus:ring-0"
        onChange={onChange}
        value={unitSystem}
      >
        {OPTIONS.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
