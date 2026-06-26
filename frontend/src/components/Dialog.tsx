import type { ReactNode } from 'react'

interface DialogProps {
  children: ReactNode
  labelledBy: string
  open: boolean
}

export function Dialog({ children, labelledBy, open }: DialogProps) {
  if (!open) {
    return null
  }

  return (
    <div
      aria-labelledby={labelledBy}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl ring-1 ring-orange-100">
        {children}
      </div>
    </div>
  )
}
