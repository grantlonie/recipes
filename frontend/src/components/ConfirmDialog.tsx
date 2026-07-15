import type { ReactNode } from 'react'

import { Button } from './Button'
import { Dialog } from './Dialog'

interface ConfirmDialogProps {
  cancelLabel?: string
  confirmLabel?: string
  confirmVariant?: 'danger' | 'primary'
  confirming?: boolean
  confirmingLabel?: string
  description: ReactNode
  labelledBy?: string
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  title: string
}

export function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel = 'Continue',
  confirmVariant = 'primary',
  confirming = false,
  confirmingLabel,
  description,
  labelledBy = 'confirm-dialog-title',
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  return (
    <Dialog className="max-w-md" labelledBy={labelledBy} open={open}>
      <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100" id={labelledBy}>
        {title}
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{description}</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button disabled={confirming} onClick={onCancel} type="button" variant="ghost">
          {cancelLabel}
        </Button>
        <Button disabled={confirming} onClick={onConfirm} type="button" variant={confirmVariant}>
          {confirming ? (confirmingLabel ?? confirmLabel) : confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
