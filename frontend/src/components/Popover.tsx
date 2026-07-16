import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface PopoverProps {
  align?: 'left' | 'right'
  children: ReactNode
  matchTriggerWidth?: boolean
  onClose: () => void
  open: boolean
  placement?: 'bottom' | 'top'
  trigger: ReactNode
}

export function Popover({
  align = 'right',
  children,
  matchTriggerWidth = false,
  onClose,
  open,
  placement = 'bottom',
  trigger,
}: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ left: number; top: number; width?: number } | null>(null)

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current
    const panelEl = panelRef.current
    if (!triggerEl || !panelEl) {
      return
    }

    const rect = triggerEl.getBoundingClientRect()
    const panelWidth = matchTriggerWidth ? rect.width : panelEl.offsetWidth
    const panelHeight = panelEl.offsetHeight
    const left = align === 'right' ? rect.right - panelWidth : rect.left
    const top = placement === 'top' ? rect.top - panelHeight - 8 : rect.bottom + 8
    setCoords({
      left,
      top,
      ...(matchTriggerWidth ? { width: rect.width } : {}),
    })
  }, [align, matchTriggerWidth, placement])

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    updatePosition()
  }, [children, open, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }

    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    const triggerEl = triggerRef.current
    const panelEl = panelRef.current
    if (!triggerEl || !panelEl) {
      return () => {
        window.removeEventListener('scroll', updatePosition, true)
        window.removeEventListener('resize', updatePosition)
      }
    }

    const observer = new ResizeObserver(updatePosition)
    observer.observe(panelEl)
    observer.observe(triggerEl)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
      observer.disconnect()
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
    <div className={matchTriggerWidth ? 'block w-full' : undefined} ref={containerRef}>
      <div className={matchTriggerWidth ? 'block w-full' : 'inline-flex'} ref={triggerRef}>
        {trigger}
      </div>
      {open
        ? createPortal(
            <div
              className={`fixed z-50 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-orange-100 dark:bg-stone-800 dark:ring-stone-700 ${
                matchTriggerWidth ? 'min-w-0' : 'min-w-52'
              }`}
              ref={panelRef}
              style={{
                left: coords?.left ?? 0,
                top: coords?.top ?? 0,
                visibility: coords ? 'visible' : 'hidden',
                width: coords?.width,
              }}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
