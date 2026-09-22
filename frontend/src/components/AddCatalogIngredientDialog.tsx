import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isEqual } from 'lodash-es'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { estimateIngredientDensities, getIngredientCatalog, upsertIngredient } from '../api'
import { putIngredientCatalog } from '../db'
import { useIngredientCatalog } from '../IngredientCatalogContext'
import { errorTextClassName, inputClassName } from '../themeClasses'
import type { CatalogIngredient } from '../types'
import { findCatalogIngredient } from '../units'
import { Button } from './Button'
import { DensityCalculator } from './DensityCalculator'
import { DensitySearchLink } from './DensitySearchLink'
import { Dialog } from './Dialog'

interface AddCatalogIngredientDialogProps {
  ingredientName: string | null
  onClose: () => void
  open: boolean
}

interface DraftState {
  aliases: string
  density: string
  name: string
}

function emptyDraft(): DraftState {
  return { aliases: '', density: '', name: '' }
}

function draftFromCatalog(item: CatalogIngredient, fallbackName: string): DraftState {
  return {
    aliases: item.aliases.join(', '),
    density: item.density_kg_m3 != null && item.density_kg_m3 > 0 ? String(item.density_kg_m3) : '',
    name: item.name || fallbackName,
  }
}

export function AddCatalogIngredientDialog({
  ingredientName,
  onClose,
  open,
}: AddCatalogIngredientDialogProps) {
  const queryClient = useQueryClient()
  const { ingredients, refresh } = useIngredientCatalog()
  const [draft, setDraft] = useState<DraftState>(emptyDraft)
  const [initial, setInitial] = useState<DraftState>(emptyDraft)
  const { aliases, density, name } = draft
  const existing = useMemo(
    () => (ingredientName ? findCatalogIngredient(ingredientName, ingredients) : undefined),
    [ingredientName, ingredients]
  )
  const dirty = !isEqual(initial, draft)

  useEffect(() => {
    if (!open || !ingredientName) {
      return
    }
    const matched = findCatalogIngredient(ingredientName, ingredients)
    const snapshot = matched
      ? draftFromCatalog(matched, ingredientName)
      : { aliases: '', density: '', name: ingredientName }
    setInitial(snapshot)
    setDraft(snapshot)
  }, [ingredientName, ingredients, open])

  useEffect(() => {
    if (!open || !ingredientName) {
      return
    }
    let cancelled = false
    void (async () => {
      const matched = findCatalogIngredient(ingredientName, ingredients)
      if (matched?.density_kg_m3 != null && matched.density_kg_m3 > 0) {
        return
      }
      try {
        const [estimate] = await estimateIngredientDensities([ingredientName])
        const value = estimate?.density_kg_m3
        if (cancelled || value == null || value <= 0) {
          return
        }
        setDraft(current =>
          current.density.trim() ? current : { ...current, density: String(Math.round(value)) }
        )
      } catch {
        // Leave blank; search icon still available.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ingredientName, ingredients, open])

  const saveMutation = useMutation({
    mutationFn: async (ingredient: CatalogIngredient) => {
      await upsertIngredient(ingredient)
    },
    onSuccess: async () => {
      const catalog = await getIngredientCatalog()
      await putIngredientCatalog(catalog)
      queryClient.setQueryData(['ingredients'], catalog)
      await refresh()
      onClose()
    },
  })

  return (
    <Dialog
      footer={
        <div className="flex gap-2">
          {!existing || dirty ? (
            <Button onClick={onClose} type="button" variant="ghost">
              Cancel
            </Button>
          ) : null}
          <Button
            className={existing ? 'w-[80px] justify-center' : undefined}
            disabled={saveMutation.isPending || !name.trim()}
            form="add-catalog-ingredient-form"
            type="submit"
          >
            {saveMutation.isPending ? 'Saving...' : existing ? (dirty ? 'Update' : 'Done') : 'Save'}
          </Button>
        </div>
      }
      onClose={onClose}
      open={open}
      title={existing ? 'Edit ingredient' : 'Add ingredient'}
      titleId="add-catalog-ingredient-title"
    >
      <form className="space-y-4" id="add-catalog-ingredient-form" onSubmit={handleSave}>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Name</span>
          <input
            className={`${inputClassName} mt-1`}
            onBlur={() => {
              void estimateDensityFromName()
            }}
            onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
            required
            value={name}
          />
        </label>
        <div>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">
              Density (kg/m³)
            </span>
            <div className="mt-1 flex items-center gap-1">
              <input
                className={`${inputClassName} min-w-0 flex-1`}
                inputMode="decimal"
                onChange={event =>
                  setDraft(current => ({ ...current, density: event.target.value }))
                }
                placeholder="Leave blank to show weight (lb/oz)"
                value={density}
              />
              <DensitySearchLink ingredientName={name} />
            </div>
            <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
              Leave blank to show weight (lb/oz) in US mode. Water is 1000.
            </span>
          </label>
          <DensityCalculator
            key={ingredientName ?? 'closed'}
            onDensityChange={value => setDraft(current => ({ ...current, density: value }))}
          />
        </div>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Aliases</span>
          <input
            className={`${inputClassName} mt-1`}
            onChange={event => setDraft(current => ({ ...current, aliases: event.target.value }))}
            placeholder="flour, ap flour"
            value={aliases}
          />
        </label>
        {saveMutation.error ? (
          <p className={`text-sm ${errorTextClassName}`}>{saveMutation.error.message}</p>
        ) : null}
      </form>
    </Dialog>
  )

  async function estimateDensityFromName() {
    if (density.trim()) {
      return
    }
    const ingredientNameValue = name.trim()
    if (!ingredientNameValue) {
      return
    }
    try {
      const [estimate] = await estimateIngredientDensities([ingredientNameValue])
      const value = estimate?.density_kg_m3
      if (value == null || value <= 0) {
        return
      }
      setDraft(current =>
        current.density.trim() ? current : { ...current, density: String(Math.round(value)) }
      )
    } catch {
      // Leave blank; search icon still available.
    }
  }

  function handleSave(event: FormEvent) {
    event.preventDefault()
    if (existing && !dirty) {
      onClose()
      return
    }
    const densityValue = density.trim()
    const parsedDensity = densityValue ? Number(densityValue) : null
    if (densityValue && Number.isNaN(parsedDensity)) {
      return
    }
    const normalizedName = name.trim().toLowerCase()
    const matched = findCatalogIngredient(normalizedName, ingredients)
    saveMutation.mutate({
      aliases: aliases
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean),
      density_kg_m3: parsedDensity,
      name: matched?.name ?? normalizedName,
    })
  }
}
