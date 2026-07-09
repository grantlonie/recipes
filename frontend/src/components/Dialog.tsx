import type { ReactNode } from 'react'
import { useEffect } from 'react'

interface DialogProps {
  children: ReactNode
  className?: string
  labelledBy: string
  open: boolean
}

let openDialogCount = 0
let savedOverflow = ''
let savedPaddingRight = ''

export function Dialog({ children, className = '', labelledBy, open }: DialogProps) {
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

  if (!open) {
    return null
  }

  return (
    <div
      aria-labelledby={labelledBy}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-900/40 p-4 overscroll-contain"
      role="dialog"
    >
      <div
        className={`my-auto max-h-[90vh] w-full overflow-y-auto rounded-3xl bg-white p-6 shadow-xl ring-1 ring-orange-100 dark:bg-stone-800 dark:ring-stone-700 ${className || 'max-w-2xl'}`}
      >
        {children}
      </div>
    </div>
  )
}
