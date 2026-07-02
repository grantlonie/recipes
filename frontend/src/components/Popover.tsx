import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'

interface PopoverProps {
  align?: 'left' | 'right'
  children: ReactNode
  onClose: () => void
  open: boolean
  trigger: ReactNode
}

export function Popover({ align = 'right', children, onClose, open, trigger }: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger) {
      return
    }

    const rect = trigger.getBoundingClientRect()
    const panelWidth = panel?.offsetWidth ?? 176
    const left = align === 'right' ? rect.right - panelWidth : rect.left
    setCoords({ left, top: rect.bottom + 8 })
  }, [align])

  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    updatePosition()
    const frame = requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return
      }
      onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose, open])

  return (
    <div ref={containerRef}>
      <div className="inline-flex" ref={triggerRef}>
        {trigger}
      </div>
      {open && coords
        ? createPortal(
            <div
              className="fixed z-50 min-w-44 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-orange-100"
              ref={panelRef}
              style={{ left: coords.left, top: coords.top }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
