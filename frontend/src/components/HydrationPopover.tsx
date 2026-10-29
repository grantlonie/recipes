import { ChevronDownIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

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
  canSave: boolean
  hydration: RecipeHydration
  onPercentChange: (percent: number) => void
  onSaved?: () => void
  percent: number
  previewError?: string | null
  savedPercent: number
  slug: string
}

export function HydrationPopover({
  canSave,
  hydration,
  onPercentChange,
  onSaved,
  percent,
  previewError,
  savedPercent,
  slug,
}: HydrationPopoverProps) {
  const queryClient = useQueryClient()
  const { notifyLocalChange } = useRecipeSync()
  const [open, setOpen] = useState(false)

  const dirty = percent !== savedPercent
  const saveMutation = useMutation({
    mutationFn: (nextPercent: number) => updateRecipeHydration(slug, nextPercent),
    onSuccess: async (recipe: RecipeDetail) => {
      queryClient.setQueryData(['recipe', slug], recipe)
      queryClient.removeQueries({ queryKey: ['recipe', slug, 'scale'] })
      await storeRecipe(recipe)
      notifyLocalChange()
      onSaved?.()
      setOpen(false)
    },
  })

  const percentLabel = `${percent}% hydration`
  const persistable = dirty && canSave
  const busy = saveMutation.isPending

  function closePopover() {
    setOpen(false)
  }

  function handleReset() {
    onPercentChange(savedPercent)
  }

  function handleDone() {
    setOpen(false)
  }

  function handleSave() {
    if (!hydration.adjustable || busy) {
      return
    }
    saveMutation.mutate(percent)
  }

  function step(delta: number) {
    onPercentChange(Math.min(100, Math.max(40, percent + delta)))
  }

  function handleInputChange(value: string) {
    if (value.trim() === '') {
      return
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return
    }
    onPercentChange(Math.min(100, Math.max(40, Math.round(parsed))))
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
            disabled={percent <= 40 || !hydration.adjustable || busy}
            icon={<MinusIcon aria-hidden="true" className="h-4 w-4" />}
            onClick={() => step(-1)}
          />
          <div className="flex items-center gap-1">
            <input
              aria-label="Hydration percent"
              className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-center text-sm tabular-nums text-stone-800 focus:border-orange-400 focus:outline-none dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
              disabled={!hydration.adjustable || busy}
              max={100}
              min={40}
              onChange={event => handleInputChange(event.target.value)}
              type="number"
              value={percent}
            />
            <span className="text-sm font-semibold text-stone-600 dark:text-stone-300">%</span>
          </div>
          <IconButton
            aria-label="Increase hydration"
            className={STEP_BUTTON_CLASS}
            disabled={percent >= 100 || !hydration.adjustable || busy}
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
              : 'Could not save hydration.'}
          </p>
        ) : null}
        {previewError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{previewError}</p>
        ) : null}
        <div className="flex items-center gap-2">
          {persistable ? (
            <Button
              className="!px-3 !py-1.5 text-xs"
              disabled={!hydration.adjustable || busy}
              onClick={handleSave}
              variant="text"
            >
              Save
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {dirty ? (
              <Button
                className="!px-3 !py-1.5 text-xs"
                disabled={busy}
                onClick={handleReset}
                variant="ghost"
              >
                Reset
              </Button>
            ) : null}
            <Button className="w-16 !px-3 !py-1.5 text-xs" disabled={busy} onClick={handleDone}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Popover>
  )
}
