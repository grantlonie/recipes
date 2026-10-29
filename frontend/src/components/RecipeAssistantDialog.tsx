import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

import { errorTextClassName, inputClassName } from '../themeClasses'

import { Button } from './Button'
import { Dialog } from './Dialog'

interface RecipeAssistantDialogProps {
  canSubmit: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (instruction: string) => void
  open: boolean
  submitting?: boolean
}

export function RecipeAssistantDialog({
  canSubmit,
  error,
  onClose,
  onSubmit,
  open,
  submitting = false,
}: RecipeAssistantDialogProps) {
  const [instruction, setInstruction] = useState('')

  useEffect(() => {
    if (!open) {
      setInstruction('')
    }
  }, [open])

  const trimmed = instruction.trim()
  const adjusting = Boolean(trimmed)
  const confirmLabel = adjusting ? 'Adjust' : 'Rewrite'
  const confirmingLabel = adjusting ? 'Adjusting...' : 'Rewriting...'

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || submitting) {
      return
    }
    onSubmit(trimmed)
  }

  return (
    <Dialog
      backdrop={{ clickaway: false }}
      footer={
        <>
          <Button disabled={submitting} onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            className="min-w-[9rem]"
            disabled={!canSubmit || submitting}
            form="recipe-assistant-form"
            type="submit"
          >
            {submitting ? confirmingLabel : confirmLabel}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      size="sm"
      title="Assistant"
      titleId="recipe-assistant-dialog-title"
    >
      <form id="recipe-assistant-form" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">
            Describe the change you want to make
          </span>
          <textarea
            autoFocus
            className={`${inputClassName} mt-1 min-h-28`}
            onChange={event => setInstruction(event.target.value)}
            placeholder="Make it vegetarian, cut the salt in half… You can also click Rewrite to clean up the whole recipe."
            value={instruction}
          />
        </label>
        {error ? <p className={`mt-3 text-sm ${errorTextClassName}`}>{error}</p> : null}
      </form>
    </Dialog>
  )
}
