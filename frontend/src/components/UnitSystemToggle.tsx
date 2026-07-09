import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { useState } from 'react'

import { useUnitSystem } from '../UnitSystemContext'
import type { UnitSystem } from '../types'
import { Popover } from './Popover'

const OPTIONS: { label: string; value: UnitSystem }[] = [
  { label: 'Metric', value: 'metric' },
  { label: 'Cups', value: 'us' },
  { label: 'lb·oz', value: 'us_weight' },
]

const TRIGGER_CLASS =
  'inline-flex items-center gap-1 border-0 bg-transparent py-0.5 text-xs font-semibold text-orange-600 focus:outline-none focus:ring-0 dark:text-orange-300'

interface UnitSystemToggleProps {
  className?: string
}

export function UnitSystemToggle({ className }: UnitSystemToggleProps = {}) {
  const { setUnitSystem, unitSystem } = useUnitSystem()
  const [open, setOpen] = useState(false)
  const currentLabel = OPTIONS.find(option => option.value === unitSystem)?.label ?? 'Metric'

  return (
    <Popover
      align="right"
      onClose={() => setOpen(false)}
      open={open}
      trigger={
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Unit system"
          className={`${TRIGGER_CLASS} ${className ?? ''}`}
          onClick={() => setOpen(current => !current)}
          type="button"
        >
          {currentLabel}
          <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="py-1" role="listbox">
        {OPTIONS.map(option => (
          <button
            aria-selected={option.value === unitSystem}
            className={`block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-orange-50 dark:hover:bg-stone-700 ${
              option.value === unitSystem
                ? 'font-semibold text-orange-700 dark:text-orange-300'
                : 'text-stone-700 dark:text-stone-200'
            }`}
            key={option.value}
            onClick={() => {
              setUnitSystem(option.value)
              setOpen(false)
            }}
            role="option"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </Popover>
  )
}
