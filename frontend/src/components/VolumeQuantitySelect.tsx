import { useMemo } from 'react'

import {
  EIGHTH_FRACTION_OPTIONS,
  eighthPartsToQuantity,
  quantityToEighthParts,
} from '../quantities'

const MAX_WHOLE = 24

const selectClassName =
  'w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2'

interface VolumeQuantitySelectProps {
  onChange: (value: string) => void
  value: string
}

export function VolumeQuantitySelect({ onChange, value }: VolumeQuantitySelectProps) {
  const { remainderEighths, whole } = useMemo(() => quantityToEighthParts(value), [value])

  const wholeOptions = useMemo(
    () => Array.from({ length: MAX_WHOLE + 1 }, (_, index) => index),
    [],
  )

  function updateParts(nextWhole: number, nextRemainderEighths: number) {
    onChange(eighthPartsToQuantity(nextWhole, nextRemainderEighths))
  }

  return (
    <div className="flex gap-2">
      <select
        aria-label="Whole amount"
        className={selectClassName}
        onChange={event => updateParts(Number(event.target.value), remainderEighths)}
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
        value={remainderEighths}
      >
        {EIGHTH_FRACTION_OPTIONS.map(option => (
          <option key={option.eighths} value={option.eighths}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
