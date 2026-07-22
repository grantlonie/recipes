import { InformationCircleIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isEqual } from 'lodash-es'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import {
  deleteIngredient,
  estimateIngredientDensities,
  getIngredientCatalog,
  renameIngredient,
  upsertIngredient,
} from './api'
import { useAuth } from './AuthContext'
import { Button } from './components/Button'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DensitySearchLink } from './components/DensitySearchLink'
import { Dialog } from './components/Dialog'
import { UnmatchedReviewDialog } from './components/UnmatchedReviewDialog'
import { putIngredientCatalog } from './db'
import { titleCaseIngredient } from './ingredientDisplay'
import { applyMappingToSavedRecipes, type MappingRow } from './importMapping'
import { useIngredientCatalog } from './IngredientCatalogContext'
import { useRecipeSync } from './RecipeSyncContext'
import { runSync } from './sync'
import { cardClassName, errorTextClassName, inputClassName } from './themeClasses'
import type { CatalogIngredient } from './types'
import { scanUnmatchedIngredients, type UnmatchedIngredientRow } from './unmatchedIngredients'

const INGREDIENT_NOTES = [
  'Densities are stored as kg/m³.',
  'Leave density blank to show weight (lb/oz) in US mode. Water is 1000.',
  'Aliases are comma-separated alternate names used for matching.',
]

interface IngredientFormState {
  aliases: string
  density: string
  name: string
}

interface SaveIngredientInput {
  ingredient: CatalogIngredient
  originalName?: string
}

function emptyIngredientForm(): IngredientFormState {
  return { aliases: '', density: '', name: '' }
}

function ingredientFormFromCatalog(item: CatalogIngredient): IngredientFormState {
  return {
    aliases: item.aliases.join(', '),
    density: item.density_kg_m3 == null ? '' : String(item.density_kg_m3),
    name: item.name,
  }
}

export function IngredientsPage() {
  const { auth } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { ingredients, refresh } = useIngredientCatalog()
  const { localRevision, notifyLocalChange } = useRecipeSync()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewApplying, setReviewApplying] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState<UnmatchedIngredientRow[]>([])
  const [editing, setEditing] = useState<CatalogIngredient | null>(null)
  const [initial, setInitial] = useState<IngredientFormState>(emptyIngredientForm)
  const [draft, setDraft] = useState<IngredientFormState>(emptyIngredientForm)
  const [query, setQuery] = useState('')

  const dirty = editing !== null && !isEqual(initial, draft)
  const { aliases, density, name } = draft

  const refreshUnmatched = useCallback(async () => {
    const rows = await scanUnmatchedIngredients(ingredients)
    setUnmatched(rows)
    return rows
  }, [ingredients])

  useEffect(() => {
    if (!auth.authenticated) {
      return
    }
    void refreshUnmatched()
  }, [auth.authenticated, ingredients, localRevision, refreshUnmatched])

  useEffect(() => {
    if (!auth.authenticated) {
      return
    }
    if (!searchParams.has('review')) {
      return
    }
    navigate('/ingredients', { replace: true })
    let cancelled = false
    void refreshUnmatched().then(rows => {
      if (!cancelled && rows.length > 0) {
        setReviewOpen(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [auth.authenticated, navigate, refreshUnmatched, searchParams])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = needle
      ? ingredients.filter(
          item =>
            item.name.toLowerCase().includes(needle) ||
            item.aliases.some(alias => alias.toLowerCase().includes(needle))
        )
      : ingredients

    return [...list].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    )
  }, [ingredients, query])

  const saveMutation = useMutation({
    mutationFn: async ({ ingredient, originalName }: SaveIngredientInput) => {
      if (originalName && originalName !== ingredient.name) {
        return renameIngredient(originalName, ingredient)
      }
      await upsertIngredient(ingredient)
      return { ingredient, updated_recipes: [] as string[] }
    },
    onSuccess: async result => {
      const catalog = await getIngredientCatalog()
      await putIngredientCatalog(catalog)
      queryClient.setQueryData(['ingredients'], catalog)
      await refresh()
      if (result.updated_recipes.length) {
        await runSync()
        await queryClient.invalidateQueries({ queryKey: ['recipes'] })
      }
      closeDialog()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (ingredientName: string) => deleteIngredient(ingredientName),
    onSuccess: async () => {
      const catalog = await getIngredientCatalog()
      await putIngredientCatalog(catalog)
      queryClient.setQueryData(['ingredients'], catalog)
      await refresh()
      closeDialog()
    },
  })

  async function handleReviewConfirm(row: MappingRow, item: UnmatchedIngredientRow) {
    setReviewApplying(true)
    setReviewError(null)
    try {
      const result = await applyMappingToSavedRecipes([row], ingredients, item.recipeSlugs, refresh)
      if (result.updatedSlugs.length) {
        notifyLocalChange()
        await queryClient.invalidateQueries({ queryKey: ['recipes'] })
      }
      const remaining = await scanUnmatchedIngredients(result.catalog)
      setUnmatched(remaining)
      if (remaining.length === 0) {
        setReviewOpen(false)
      }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not save ingredient')
    } finally {
      setReviewApplying(false)
    }
  }

  if (!auth.authenticated) {
    return (
      <section className={`mx-auto max-w-md ${cardClassName}`}>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Sign in required</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          Editor access is required to manage ingredients.
        </p>
        <Link
          className="mt-6 inline-flex rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          to="/login"
        >
          Sign in
        </Link>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className={`flex min-h-0 flex-1 flex-col ${cardClassName}`}>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-stone-900 dark:text-stone-100">Ingredients</h1>
          <button
            aria-label="Ingredient catalog notes"
            className="inline-flex rounded-full p-1 text-stone-400 transition hover:bg-orange-50 hover:text-stone-600 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            onClick={() => setInfoOpen(true)}
            type="button"
          >
            <InformationCircleIcon aria-hidden="true" className="h-6 w-6" />
          </button>
        </div>

        {unmatched.length > 0 ? (
          <button
            className="mt-4 w-full rounded-2xl bg-amber-50 px-4 py-3 text-left ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950/40 dark:ring-amber-900 dark:hover:bg-amber-950/60"
            onClick={() => {
              setReviewError(null)
              setReviewOpen(true)
            }}
            type="button"
          >
            <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
              {unmatched.length} unmatched ingredient{unmatched.length === 1 ? '' : 's'}
            </p>
            <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
              Review to add density or map to the catalog.
            </p>
          </button>
        ) : null}

        <div className="mt-6 flex items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search ingredients</span>
            <input
              autoFocus
              className={inputClassName}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search ingredients"
              type="search"
              value={query}
            />
          </label>
          <Button
            className="inline-flex shrink-0 items-center gap-1.5"
            onClick={() => openCreate()}
          >
            <PlusIcon aria-hidden="true" className="h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          {filtered.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="pb-6">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-white text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                    <tr className="border-b border-stone-200 dark:border-stone-600">
                      <th className="py-2 pr-4 font-semibold">Name</th>
                      <th className="py-2 pr-4 font-semibold">Density (kg/m³)</th>
                      <th className="py-2 font-semibold">Aliases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(item => (
                      <tr
                        className="cursor-pointer border-b border-orange-50 hover:bg-orange-50 dark:border-stone-700 dark:hover:bg-stone-700/60"
                        key={item.name}
                        onClick={() => openEdit(item)}
                      >
                        <td className="py-3 pr-4 font-medium text-stone-900 dark:text-stone-100">
                          {titleCaseIngredient(item.name)}
                        </td>
                        <td className="py-3 pr-4 tabular-nums text-stone-700 dark:text-stone-300">
                          {item.density_kg_m3 ?? '—'}
                        </td>
                        <td className="max-w-xs py-3 text-stone-600 dark:text-stone-400 sm:max-w-sm md:max-w-md">
                          <span className="line-clamp-3">
                            {item.aliases.map(titleCaseIngredient).join(', ') || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-stone-500 dark:text-stone-400">
              No ingredients match your search.
            </p>
          )}
        </div>
      </div>

      <Dialog labelledBy="ingredient-info-dialog-title" open={infoOpen}>
        <h2
          className="text-xl font-bold text-stone-900 dark:text-stone-100"
          id="ingredient-info-dialog-title"
        >
          Notes
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-stone-600 dark:text-stone-400">
          {INGREDIENT_NOTES.map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setInfoOpen(false)} type="button" variant="ghost">
            Close
          </Button>
        </div>
      </Dialog>

      <Dialog labelledBy="ingredient-catalog-dialog-title" open={dialogOpen}>
        <h2 className="text-xl font-bold" id="ingredient-catalog-dialog-title">
          {editing ? 'Edit ingredient' : 'Add ingredient'}
        </h2>
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
          <label className="block">
            <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">
              Aliases
            </span>
            <input
              className={`${inputClassName} mt-1`}
              onChange={event => setDraft(current => ({ ...current, aliases: event.target.value }))}
              placeholder="flour, ap flour"
              value={aliases}
            />
            <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
              Comma-separated alternate names.
            </span>
          </label>
          {saveMutation.error ? (
            <p className={`text-sm ${errorTextClassName}`}>{saveMutation.error.message}</p>
          ) : null}
          {deleteMutation.error ? (
            <p className={`text-sm ${errorTextClassName}`}>{deleteMutation.error.message}</p>
          ) : null}
          <div className="flex justify-between gap-2">
            {editing ? (
              <Button
                disabled={deleteMutation.isPending || saveMutation.isPending}
                onClick={handleDelete}
                type="button"
                variant="danger"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {!editing || dirty ? (
                <Button onClick={closeDialog} type="button" variant="ghost">
                  Cancel
                </Button>
              ) : null}
              <Button
                className={editing ? 'w-[80px] justify-center' : undefined}
                disabled={saveMutation.isPending || !name.trim()}
                type="submit"
              >
                {saveMutation.isPending
                  ? 'Saving...'
                  : editing
                    ? dirty
                      ? 'Update'
                      : 'Done'
                    : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>

      <UnmatchedReviewDialog
        applying={reviewApplying}
        catalog={ingredients}
        error={reviewError}
        onClose={() => {
          setReviewOpen(false)
          setReviewError(null)
        }}
        onConfirm={(row, item) => void handleReviewConfirm(row, item)}
        open={reviewOpen}
        unmatched={unmatched}
      />

      <ConfirmDialog
        confirmLabel="Delete"
        confirmVariant="danger"
        confirming={deleteMutation.isPending}
        confirmingLabel="Deleting..."
        description={
          <>
            Delete &ldquo;{editing ? titleCaseIngredient(editing.name) : ''}&rdquo;? This cannot be
            undone.
          </>
        }
        labelledBy="delete-ingredient-title"
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        open={deleteConfirmOpen}
        title="Delete ingredient?"
      />
    </section>
  )

  function openCreate() {
    const snapshot = emptyIngredientForm()
    setEditing(null)
    setInitial(snapshot)
    setDraft(snapshot)
    setDialogOpen(true)
  }

  function openEdit(item: CatalogIngredient) {
    const snapshot = ingredientFormFromCatalog(item)
    setEditing(item)
    setInitial(snapshot)
    setDraft(snapshot)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDeleteConfirmOpen(false)
    setDialogOpen(false)
    setEditing(null)
    const snapshot = emptyIngredientForm()
    setInitial(snapshot)
    setDraft(snapshot)
  }

  async function estimateDensityFromName() {
    if (editing || density.trim()) {
      return
    }
    const ingredientName = name.trim()
    if (!ingredientName) {
      return
    }
    try {
      const [estimate] = await estimateIngredientDensities([ingredientName])
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

  function handleDelete() {
    if (!editing) {
      return
    }
    setDeleteConfirmOpen(true)
  }

  function confirmDelete() {
    if (!editing) {
      return
    }
    setDeleteConfirmOpen(false)
    deleteMutation.mutate(editing.name)
  }

  function handleSave(event: FormEvent) {
    event.preventDefault()
    if (editing && !dirty) {
      closeDialog()
      return
    }
    const densityValue = density.trim()
    const parsedDensity = densityValue ? Number(densityValue) : null
    if (densityValue && Number.isNaN(parsedDensity)) {
      return
    }
    const normalizedName = name.trim().toLowerCase()
    saveMutation.mutate({
      ingredient: {
        aliases: aliases
          .split(',')
          .map(item => item.trim().toLowerCase())
          .filter(Boolean),
        density_kg_m3: parsedDensity,
        name: normalizedName,
      },
      originalName: editing?.name,
    })
  }
}
