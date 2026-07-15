import { useMemo } from 'react'

import { FRACTION_OPTIONS, partsToQuantity, quantityToParts } from '../quantities'
import { inputClassName } from '../themeClasses'

const MAX_WHOLE = 24

const selectClassName = inputClassName

interface VolumeQuantitySelectProps {
  onChange: (value: string) => void
  value: string
}

export function VolumeQuantitySelect({ onChange, value }: VolumeQuantitySelectProps) {
  const { fraction, whole } = useMemo(() => quantityToParts(value), [value])

  const wholeOptions = useMemo(() => Array.from({ length: MAX_WHOLE + 1 }, (_, index) => index), [])

  const selectedFraction = useMemo(() => {
    const match = FRACTION_OPTIONS.find(option => Math.abs(option.value - fraction) < 1e-9)
    return match?.value ?? 0
  }, [fraction])

  function updateParts(nextWhole: number, nextFraction: number) {
    onChange(partsToQuantity(nextWhole, nextFraction))
  }

  return (
    <div className="flex gap-2">
      <select
        aria-label="Whole amount"
        className={selectClassName}
        onChange={event => updateParts(Number(event.target.value), selectedFraction)}
        value={whole}
      >
        {wholeOptions.map(option => (
          <option key={option} value={option}>
            {option === 0 ? '—' : option}
          </option>
        ))}
      </select>
      <select
        aria-label="Fractional amount"
        className={selectClassName}
        onChange={event => updateParts(whole, Number(event.target.value))}
        value={selectedFraction}
      >
        {FRACTION_OPTIONS.map(option => (
          <option key={option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
