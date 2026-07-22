import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Autocomplete } from './Autocomplete'
import { Button } from './Button'
import { DensitySearchLink } from './DensitySearchLink'
import { Dialog } from './Dialog'
import { titleCaseIngredient } from '../ingredientDisplay'
import {
  autofillMappingDensities,
  isMappingRowValid,
  mappingRowDensityValid,
  mappingRowNeedsCreate,
  type MappingRow,
} from '../importMapping'
import {
  errorTextClassName,
  inputClassName,
  mappingCreateCardClassName,
  mappingCreateTitleClassName,
} from '../themeClasses'
import type { CatalogIngredient } from '../types'
import type { UnmatchedIngredientRow } from '../unmatchedIngredients'

interface UnmatchedReviewDialogProps {
  applying?: boolean
  catalog: CatalogIngredient[]
  error?: string | null
  onClose: () => void
  onConfirm: (row: MappingRow, unmatched: UnmatchedIngredientRow) => void
  open: boolean
  unmatched: UnmatchedIngredientRow[]
}

export function UnmatchedReviewDialog({
  applying = false,
  catalog,
  error = null,
  onClose,
  onConfirm,
  open,
  unmatched,
}: UnmatchedReviewDialogProps) {
  const [index, setIndex] = useState(0)
  const [row, setRow] = useState<MappingRow | null>(null)

  const current = unmatched[index] ?? null

  useEffect(() => {
    if (!open) {
      return
    }
    setIndex(0)
  }, [open, unmatched])

  useEffect(() => {
    if (!current) {
      setRow(null)
      return
    }
    const example = current.examples[0]
    const next: MappingRow = {
      catalogName: current.name,
      createDensity: '',
      excluded: false,
      fixed: false,
      note: '',
      originalName: current.name,
      quantity: example?.quantity ?? '',
      unit: example?.unit ?? '',
    }
    setRow(next)
    void autofillMappingDensities([next], catalog).then(filled => {
      const density = filled[0]?.createDensity
      if (!density?.trim()) {
        return
      }
      setRow(currentRow => {
        if (
          !currentRow ||
          currentRow.originalName.toLowerCase() !== next.originalName.toLowerCase()
        ) {
          return currentRow
        }
        if (currentRow.createDensity.trim()) {
          return currentRow
        }
        return { ...currentRow, createDensity: density }
      })
    })
  }, [catalog, current])

  const ingredientOptions = useMemo(
    () =>
      catalog.map(item => ({
        label: item.density_kg_m3 == null ? `${item.name} (weight)` : item.name,
        value: item.name,
      })),
    [catalog]
  )

  if (!open) {
    return null
  }

  if (unmatched.length === 0) {
    return (
      <Dialog labelledBy="unmatched-review-title" open={open}>
        <h2 className="text-xl font-bold" id="unmatched-review-title">
          Review unmatched ingredients
        </h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          No unmatched ingredients right now.
        </p>
        <div className="mt-6 flex justify-end">
          <Button onClick={onClose} type="button">
            Done
          </Button>
        </div>
      </Dialog>
    )
  }

  if (!current || !row) {
    return null
  }

  const needsCreate = mappingRowNeedsCreate(row, catalog)
  const densityInvalid = !mappingRowDensityValid(row)
  const canConfirm = isMappingRowValid(row, catalog)
  const remaining = unmatched.length - index

  function patchRow(patch: Partial<MappingRow>) {
    setRow(currentRow => (currentRow ? { ...currentRow, ...patch } : currentRow))
  }

  function handleConfirm() {
    if (!row || !current || !canConfirm || applying) {
      return
    }
    onConfirm(row, current)
  }

  function handleSkip() {
    if (index + 1 >= unmatched.length) {
      onClose()
      return
    }
    setIndex(currentIndex => currentIndex + 1)
  }

  return (
    <Dialog labelledBy="unmatched-review-title" open={open}>
      <h2 className="text-xl font-bold" id="unmatched-review-title">
        Review unmatched ingredients
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        {remaining} remaining. Add to your catalog or map to an existing ingredient.
      </p>

      <div
        className={`mt-4 rounded-2xl p-3 ${
          needsCreate
            ? mappingCreateCardClassName
            : 'bg-orange-50 ring-1 ring-orange-100 dark:bg-stone-800 dark:ring-stone-700'
        }`}
      >
        <div>
          <p className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {titleCaseIngredient(current.name)}
          </p>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            Used in {current.recipeCount} recipe{current.recipeCount === 1 ? '' : 's'}
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold text-stone-700 dark:text-stone-200">Ingredient</span>
            <div className="mt-1">
              <Autocomplete
                onChange={catalogName => patchRow({ catalogName })}
                options={ingredientOptions}
                placeholder="Search or enter name"
                value={row.catalogName}
              />
            </div>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-stone-700 dark:text-stone-200">Details</span>
            <input
              className={`${inputClassName} mt-1`}
              onChange={event => patchRow({ note: event.target.value })}
              placeholder="large, bittersweet, unsalted…"
              value={row.note}
            />
          </label>
        </div>
        {needsCreate ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className={`text-sm font-semibold ${mappingCreateTitleClassName}`}>
                Create new ingredient
              </p>
              <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
                Optional density enables volume↔weight conversion when viewing.
              </p>
            </div>
            <label className="block text-sm">
              <span className="font-semibold text-stone-700 dark:text-stone-200">
                Density (kg/m³)
              </span>
              <div className="mt-1 flex items-center gap-1">
                <input
                  className={`${inputClassName} min-w-0 flex-1${densityInvalid ? ' border-red-400 ring-red-400' : ''}`}
                  onChange={event => patchRow({ createDensity: event.target.value })}
                  placeholder="Optional"
                  value={row.createDensity}
                />
                <DensitySearchLink ingredientName={row.catalogName} />
              </div>
            </label>
          </div>
        ) : null}
      </div>

      {current.examples.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
            Example recipe usage
          </p>
          <ul className="mt-2 space-y-2">
            {current.examples.map(example => (
              <li
                className="rounded-xl bg-stone-50 px-3 py-2 text-sm dark:bg-stone-900/60"
                key={`${example.slug}-${example.quantity}-${example.unit}`}
              >
                <p className="text-stone-800 dark:text-stone-100">
                  {[example.quantity, example.unit, titleCaseIngredient(current.name)]
                    .filter(Boolean)
                    .join(' ')}
                </p>
                <Link
                  className="mt-0.5 inline-block text-xs font-semibold text-orange-700 hover:underline dark:text-orange-400"
                  to={`/recipes/${example.slug}`}
                >
                  {example.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!canConfirm ? (
        <p className={`mt-3 text-sm ${errorTextClassName}`}>Enter an ingredient name.</p>
      ) : null}
      {error ? <p className={`mt-3 text-sm ${errorTextClassName}`}>{error}</p> : null}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button disabled={applying} onClick={onClose} type="button" variant="ghost">
          Close
        </Button>
        <Button disabled={applying} onClick={handleSkip} type="button" variant="secondary">
          Skip
        </Button>
        <Button disabled={!canConfirm || applying} onClick={handleConfirm} type="button">
          {applying ? 'Saving…' : 'Done'}
        </Button>
      </div>
    </Dialog>
  )
}
