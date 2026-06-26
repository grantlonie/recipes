import type { ReactNode } from 'react'

interface PopoverProps {
  align?: 'left' | 'right'
  children: ReactNode
  open: boolean
  trigger: ReactNode
}

export function Popover({ align = 'right', children, open, trigger }: PopoverProps) {
  return (
    <div className="relative">
      {trigger}
      {open ? (
        <div
          className={`absolute z-30 mt-2 min-w-44 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-orange-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
