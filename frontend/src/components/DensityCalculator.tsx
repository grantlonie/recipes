import type { ChangeEvent } from 'react'
import { useState } from 'react'

import { parseQuantity } from '../quantities'
import { inputClassName } from '../themeClasses'
import { DENSITY_MASS_UNITS, DENSITY_VOLUME_UNITS, densityFromMassVolume } from '../units'
import { useUnitSystem } from '../UnitSystemContext'

interface DensityCalculatorProps {
  onDensityChange: (density: string) => void
}

interface MeasurementState {
  massQuantity: string
  massUnit: string
  volumeQuantity: string
  volumeUnit: string
}

const selectClassName =
  'w-[6.5rem] shrink-0 rounded-xl border border-orange-200 bg-white px-2 py-2 outline-none ring-orange-500 focus:ring-2 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100'

export function DensityCalculator({ onDensityChange }: DensityCalculatorProps) {
  const { unitSystem } = useUnitSystem()
  const [measurement, setMeasurement] = useState<MeasurementState>(() => ({
    massQuantity: '',
    massUnit: unitSystem === 'metric' ? 'g' : 'oz',
    volumeQuantity: '',
    volumeUnit: 'cup',
  }))

  function handleVolumeQuantityChange(event: ChangeEvent<HTMLInputElement>) {
    updateMeasurement({ volumeQuantity: event.target.value })
  }

  function handleVolumeUnitChange(event: ChangeEvent<HTMLSelectElement>) {
    updateMeasurement({ volumeUnit: event.target.value })
  }

  function handleMassQuantityChange(event: ChangeEvent<HTMLInputElement>) {
    updateMeasurement({ massQuantity: event.target.value })
  }

  function handleMassUnitChange(event: ChangeEvent<HTMLSelectElement>) {
    updateMeasurement({ massUnit: event.target.value })
  }

  function updateMeasurement(patch: Partial<MeasurementState>) {
    const next = { ...measurement, ...patch }
    setMeasurement(next)
    const density = densityFromFields(next)
    if (density == null) {
      return
    }
    const rounded = Math.round(density)
    if (rounded <= 0) {
      return
    }
    onDensityChange(String(rounded))
  }

  return (
    <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-3 dark:border-stone-600 dark:bg-stone-900/50">
      <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">
        Calculate from a measurement
      </p>
      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
        Weigh a known volume to fill density automatically.
      </p>
      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2">
        <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Volume</span>
        <input
          aria-label="Measured volume"
          className={inputClassName}
          inputMode="decimal"
          onChange={handleVolumeQuantityChange}
          placeholder="2"
          value={measurement.volumeQuantity}
        />
        <select
          aria-label="Volume unit"
          className={selectClassName}
          onChange={handleVolumeUnitChange}
          value={measurement.volumeUnit}
        >
          {DENSITY_VOLUME_UNITS.map(unit => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
        <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Mass</span>
        <input
          aria-label="Measured mass"
          className={inputClassName}
          inputMode="decimal"
          onChange={handleMassQuantityChange}
          placeholder="180"
          value={measurement.massQuantity}
        />
        <select
          aria-label="Mass unit"
          className={selectClassName}
          onChange={handleMassUnitChange}
          value={measurement.massUnit}
        >
          {DENSITY_MASS_UNITS.map(unit => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function densityFromFields(measurement: MeasurementState): number | null {
  const massQuantity = parseQuantity(measurement.massQuantity)
  const volumeQuantity = parseQuantity(measurement.volumeQuantity)
  if (massQuantity == null || volumeQuantity == null) {
    return null
  }
  return densityFromMassVolume(
    massQuantity,
    measurement.massUnit,
    volumeQuantity,
    measurement.volumeUnit
  )
}
