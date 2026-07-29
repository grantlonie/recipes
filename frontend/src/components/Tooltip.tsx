import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, useState } from 'react'

export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  delayMs?: number
  position?: 'bottom' | 'left' | 'right' | 'top'
}

export function Tooltip({ children, content, delayMs = 400, position = 'top' }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)
  const showTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (showTimerRef.current != null) {
        window.clearTimeout(showTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    const trigger = triggerRef.current
    if (!trigger) {
      return
    }
    const rect = trigger.getBoundingClientRect()
    const gap = 8
    let left = rect.left + rect.width / 2
    let top = rect.top
    if (position === 'bottom') {
      top = rect.bottom + gap
    } else if (position === 'left') {
      left = rect.left - gap
      top = rect.top + rect.height / 2
    } else if (position === 'right') {
      left = rect.right + gap
      top = rect.top + rect.height / 2
    } else {
      top = rect.top - gap
    }
    setCoords({ left, top })
  }, [open, position])

  function clearShowTimer() {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }

  function handleEnter() {
    clearShowTimer()
    showTimerRef.current = window.setTimeout(() => setOpen(true), delayMs)
  }

  function handleLeave() {
    clearShowTimer()
    setOpen(false)
  }

  const transformClass =
    position === 'bottom'
      ? '-translate-x-1/2'
      : position === 'left'
        ? '-translate-x-full -translate-y-1/2'
        : position === 'right'
          ? '-translate-y-1/2'
          : '-translate-x-1/2 -translate-y-full'

  return (
    <>
      <span
        aria-describedby={open ? tipId : undefined}
        className="inline-flex"
        onBlur={handleLeave}
        onFocus={handleEnter}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        ref={triggerRef}
      >
        {children}
      </span>
      {open && coords
        ? createPortal(
            <span
              className={`pointer-events-none fixed z-70 rounded-lg bg-stone-900 px-2 py-1 text-xs font-medium text-white shadow-lg dark:bg-stone-100 dark:text-stone-900 ${transformClass}`}
              id={tipId}
              role="tooltip"
              style={{ left: coords.left, top: coords.top }}
            >
              {content}
            </span>,
            document.body
          )
        : null}
    </>
  )
}
