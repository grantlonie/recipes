import { ChevronDownIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { updateRecipeHydration } from '../api'
import { useRecipeSync } from '../RecipeSyncContext'
import { storeRecipe } from '../sync'
import type { RecipeDetail, RecipeHydration } from '../types'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { Popover } from './Popover'

const TRIGGER_CLASS =
  'inline-flex items-center gap-1 border-0 bg-transparent py-0.5 text-xs font-semibold tabular-nums text-orange-600 focus:outline-none focus:ring-0 dark:text-orange-300'

const STEP_BUTTON_CLASS = '!h-8 !w-8'

interface HydrationPopoverProps {
  canEdit: boolean
  hydration: RecipeHydration
  slug: string
}

export function HydrationPopover({ canEdit, hydration, slug }: HydrationPopoverProps) {
  const queryClient = useQueryClient()
  const { notifyLocalChange } = useRecipeSync()
  const [open, setOpen] = useState(false)
  const savedPercent = Math.round(hydration.percent ?? 0)
  const [draftPercent, setDraftPercent] = useState(savedPercent)

  useEffect(() => {
    if (!open) {
      setDraftPercent(Math.round(hydration.percent ?? 0))
    }
  }, [hydration.percent, open])

  const dirty = draftPercent !== savedPercent
  const saveMutation = useMutation({
    mutationFn: (percent: number) => updateRecipeHydration(slug, percent),
    onSuccess: async (recipe: RecipeDetail) => {
      queryClient.setQueryData(['recipe', slug], recipe)
      queryClient.removeQueries({ queryKey: ['recipe', slug, 'scale'] })
      await storeRecipe(recipe)
      notifyLocalChange()
      setOpen(false)
    },
  })

  const percentLabel =
    hydration.percent == null ? 'Hydration' : `${Math.round(hydration.percent)}% hydration`

  if (!canEdit) {
    return <span className={TRIGGER_CLASS}>{percentLabel}</span>
  }

  function closePopover() {
    setOpen(false)
    setDraftPercent(savedPercent)
  }

  function handleCancel() {
    setDraftPercent(savedPercent)
  }

  function handlePrimary() {
    if (!dirty) {
      setOpen(false)
      return
    }
    if (!hydration.adjustable || saveMutation.isPending) {
      return
    }
    saveMutation.mutate(draftPercent)
  }

  function step(delta: number) {
    setDraftPercent(current => Math.min(100, Math.max(40, current + delta)))
  }

  function handleInputChange(value: string) {
    if (value.trim() === '') {
      return
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return
    }
    setDraftPercent(Math.min(100, Math.max(40, Math.round(parsed))))
  }

  return (
    <Popover
      align="left"
      onClose={closePopover}
      open={open}
      trigger={
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Recipe hydration"
          className={TRIGGER_CLASS}
          onClick={() => setOpen(current => !current)}
          type="button"
        >
          {percentLabel}
          <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="min-w-[16rem] space-y-3 p-3">
        <div className="flex items-center justify-center gap-2">
          <IconButton
            aria-label="Decrease hydration"
            className={STEP_BUTTON_CLASS}
            disabled={draftPercent <= 40 || saveMutation.isPending}
            icon={<MinusIcon aria-hidden="true" className="h-4 w-4" />}
            onClick={() => step(-1)}
          />
          <div className="flex items-center gap-1">
            <input
              aria-label="Hydration percent"
              className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-center text-sm tabular-nums text-stone-800 focus:border-orange-400 focus:outline-none dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
              disabled={saveMutation.isPending}
              max={100}
              min={40}
              onChange={event => handleInputChange(event.target.value)}
              type="number"
              value={draftPercent}
            />
            <span className="text-sm font-semibold text-stone-600 dark:text-stone-300">%</span>
          </div>
          <IconButton
            aria-label="Increase hydration"
            className={STEP_BUTTON_CLASS}
            disabled={draftPercent >= 100 || saveMutation.isPending}
            icon={<PlusIcon aria-hidden="true" className="h-4 w-4" />}
            onClick={() => step(1)}
          />
        </div>
        {!hydration.adjustable ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {hydration.issues[0] ?? 'Cannot adjust hydration for this recipe.'}
          </p>
        ) : null}
        {saveMutation.isError ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            {saveMutation.error instanceof Error
              ? saveMutation.error.message
              : 'Could not update hydration.'}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <Button
              className="!px-3 !py-1.5 text-xs"
              disabled={saveMutation.isPending}
              onClick={handleCancel}
              variant="ghost"
            >
              Cancel
            </Button>
          ) : null}
          <Button
            className="w-16 !px-3 !py-1.5 text-xs"
            disabled={dirty && (!hydration.adjustable || saveMutation.isPending)}
            onClick={handlePrimary}
            variant="primary"
          >
            {dirty ? 'Save' : 'Done'}
          </Button>
        </div>
      </div>
    </Popover>
  )
}
