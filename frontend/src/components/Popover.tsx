import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

interface PopoverProps {
  align?: 'left' | 'right'
  children: ReactNode
  onClose: () => void
  open: boolean
  trigger: ReactNode
}

export function Popover({ align = 'right', children, onClose, open, trigger }: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose, open])

  return (
    <div className="relative" ref={containerRef}>
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
