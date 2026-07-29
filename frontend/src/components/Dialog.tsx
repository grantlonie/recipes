import { XMarkIcon } from '@heroicons/react/24/outline'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEffect, useId } from 'react'

import { IconButton } from './IconButton'

export interface DialogBackdropOptions {
  clickaway?: boolean
}

export interface DialogProps {
  backdrop?: DialogBackdropOptions
  children: ReactNode
  footer?: ReactNode
  lazyMount?: boolean
  onClose: () => void
  open: boolean
  placement?: 'center' | 'top'
  size?: 'full' | 'lg' | 'md' | 'sm'
  title: ReactNode
  titleId?: string
}

const SIZE_CLASS: Record<NonNullable<DialogProps['size']>, string> = {
  full: 'max-w-5xl',
  lg: 'max-w-3xl',
  md: 'max-w-2xl',
  sm: 'max-w-md',
}

let openDialogCount = 0
let savedOverflow = ''
let savedPaddingRight = ''

export function Dialog({
  backdrop,
  children,
  footer,
  lazyMount = false,
  onClose,
  open,
  placement = 'top',
  size = 'md',
  title,
  titleId,
}: DialogProps) {
  const generatedId = useId()
  const labelledBy = titleId ?? generatedId
  const clickaway = backdrop?.clickaway ?? true

  useEffect(() => {
    if (!open) {
      return
    }

    openDialogCount += 1
    if (openDialogCount === 1) {
      savedOverflow = document.body.style.overflow
      savedPaddingRight = document.body.style.paddingRight
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`
      }
    }

    return () => {
      openDialogCount -= 1
      if (openDialogCount === 0) {
        document.body.style.overflow = savedOverflow
        document.body.style.paddingRight = savedPaddingRight
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  // Content unmounts when closed; `lazyMount` is reserved for API parity with UI_PATTERNS.
  if (!open) {
    return null
  }
  void lazyMount

  const placementClass =
    placement === 'center' ? 'items-center' : 'items-start pt-[min(10vh,4rem)] sm:pt-[12vh]'

  return createPortal(
    <div
      aria-labelledby={labelledBy}
      aria-modal="true"
      className={`fixed inset-0 z-50 flex justify-center overflow-y-auto bg-stone-900/40 p-4 overscroll-contain ${placementClass}`}
      onClick={clickaway ? onClose : undefined}
      role="dialog"
    >
      <div
        className={`my-auto flex max-h-[min(90vh,52rem)] w-full flex-col overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-orange-100 dark:bg-stone-800 dark:ring-stone-700 ${SIZE_CLASS[size]}`}
        onClick={event => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 px-6 pt-6 pb-3">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100" id={labelledBy}>
            {title}
          </h2>
          <IconButton
            aria-label="Close"
            icon={<XMarkIcon aria-hidden="true" className="h-5 w-5" />}
            onClick={onClose}
            tooltip={{ content: 'Close' }}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pt-2 pb-6">
            {footer}
          </footer>
        ) : (
          <div className="pb-6" />
        )}
      </div>
    </div>,
    document.body
  )
}
