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
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  title: string
  titleId?: string
}

export function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel = 'Continue',
  confirmVariant = 'primary',
  confirming = false,
  confirmingLabel,
  description,
  onCancel,
  onConfirm,
  open,
  title,
  titleId = 'confirm-dialog-title',
}: ConfirmDialogProps) {
  return (
    <Dialog
      backdrop={{ clickaway: false }}
      footer={
        <>
          <Button disabled={confirming} onClick={onCancel} type="button" variant="ghost">
            {cancelLabel}
          </Button>
          <Button disabled={confirming} onClick={onConfirm} type="button" variant={confirmVariant}>
            {confirming ? (confirmingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      placement="center"
      size="sm"
      title={title}
      titleId={titleId}
    >
      <p className="text-sm text-stone-600 dark:text-stone-400">{description}</p>
    </Dialog>
  )
}
