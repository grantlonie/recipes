import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

import { estimateIngredientDensities, getIngredientCatalog, upsertIngredient } from '../api'
import { putIngredientCatalog } from '../db'
import { useIngredientCatalog } from '../IngredientCatalogContext'
import { errorTextClassName, inputClassName } from '../themeClasses'
import type { CatalogIngredient } from '../types'
import { findCatalogIngredient } from '../units'
import { Button } from './Button'
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

export function AddCatalogIngredientDialog({
  ingredientName,
  onClose,
  open,
}: AddCatalogIngredientDialogProps) {
  const queryClient = useQueryClient()
  const { ingredients, refresh } = useIngredientCatalog()
  const [draft, setDraft] = useState<DraftState>({ aliases: '', density: '', name: '' })
  const { aliases, density, name } = draft

  useEffect(() => {
    if (!open || !ingredientName) {
      return
    }
    const existing = findCatalogIngredient(ingredientName, ingredients)
    setDraft({
      aliases: existing?.aliases.join(', ') ?? '',
      density:
        existing?.density_kg_m3 != null && existing.density_kg_m3 > 0
          ? String(existing.density_kg_m3)
          : '',
      name: existing?.name ?? ingredientName,
    })
  }, [ingredientName, ingredients, open])

  useEffect(() => {
    if (!open || !ingredientName) {
      return
    }
    let cancelled = false
    void (async () => {
      const existing = findCatalogIngredient(ingredientName, ingredients)
      if (existing?.density_kg_m3 != null && existing.density_kg_m3 > 0) {
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
    <Dialog labelledBy="add-catalog-ingredient-title" open={open}>
      <h2 className="text-xl font-bold" id="add-catalog-ingredient-title">
        Add ingredient density
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Density is needed to convert this ingredient between volume and weight.
      </p>
      <form className="mt-4 space-y-4" onSubmit={handleSave}>
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
        <label className="block">
          <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">
            Density (kg/m³)
          </span>
          <div className="mt-1 flex items-center gap-1">
            <input
              className={`${inputClassName} min-w-0 flex-1`}
              inputMode="decimal"
              onChange={event => setDraft(current => ({ ...current, density: event.target.value }))}
              placeholder="Required for volume conversion"
              required
              value={density}
            />
            <DensitySearchLink ingredientName={name} />
          </div>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
            Water is 1000. Used to convert between cups/ml and grams.
          </span>
        </label>
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
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={saveMutation.isPending || !name.trim()} type="submit">
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
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
    const densityValue = density.trim()
    const parsedDensity = densityValue ? Number(densityValue) : null
    if (densityValue && Number.isNaN(parsedDensity)) {
      return
    }
    if (parsedDensity == null || parsedDensity <= 0) {
      return
    }
    const normalizedName = name.trim().toLowerCase()
    const existing = findCatalogIngredient(normalizedName, ingredients)
    saveMutation.mutate({
      aliases: aliases
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean),
      density_kg_m3: parsedDensity,
      name: existing?.name ?? normalizedName,
    })
  }
}
