import { InformationCircleIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { deleteIngredient, getIngredientCatalog, upsertIngredient } from './api'
import { useAuth } from './AuthContext'
import { Button } from './components/Button'
import { DensitySearchLink } from './components/DensitySearchLink'
import { Dialog } from './components/Dialog'
import { putIngredientCatalog } from './db'
import { titleCaseIngredient } from './ingredientDisplay'
import { useIngredientCatalog } from './IngredientCatalogContext'
import type { CatalogIngredient } from './types'
import { cardClassName, inputClassName } from './themeClasses'

const INGREDIENT_NOTES = [
  'Densities are stored as kg/m³.',
  'Leave density blank to show weight (lb/oz) in US mode. Water is 1000.',
  'Aliases are comma-separated alternate names used for matching.',
]

export function IngredientsPage() {
  const { auth } = useAuth()
  const queryClient = useQueryClient()
  const { ingredients, refresh } = useIngredientCatalog()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [editing, setEditing] = useState<CatalogIngredient | null>(null)
  const [name, setName] = useState('')
  const [density, setDensity] = useState('')
  const [aliases, setAliases] = useState('')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = needle
      ? ingredients.filter(
          item =>
            item.name.toLowerCase().includes(needle) ||
            item.aliases.some(alias => alias.toLowerCase().includes(needle)),
        )
      : ingredients

    return [...list].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
    )
  }, [ingredients, query])

  const saveMutation = useMutation({
    mutationFn: async ({
      ingredient,
      originalName,
    }: {
      ingredient: CatalogIngredient
      originalName?: string
    }) => {
      if (originalName && originalName !== ingredient.name) {
        await deleteIngredient(originalName)
      }
      return upsertIngredient(ingredient)
    },
    onSuccess: async () => {
      const catalog = await getIngredientCatalog()
      await putIngredientCatalog(catalog)
      queryClient.setQueryData(['ingredients'], catalog)
      await refresh()
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

  if (!auth.authenticated) {
    return (
      <section className={`mx-auto max-w-md ${cardClassName}`}>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Sign in required</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">Editor access is required to manage ingredients.</p>
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

        <div className="mt-6 flex items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search ingredients</span>
            <input
              className={inputClassName}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search ingredients"
              type="search"
              value={query}
            />
          </label>
          <Button className="inline-flex shrink-0 items-center gap-1.5" onClick={() => openCreate()}>
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
            <p className="text-sm text-stone-500 dark:text-stone-400">No ingredients match your search.</p>
          )}
        </div>
      </div>

      <Dialog labelledBy="ingredient-info-dialog-title" open={infoOpen}>
        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100" id="ingredient-info-dialog-title">
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
              onChange={event => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Density (kg/m³)</span>
            <div className="mt-1 flex items-center gap-1">
              <input
                className={`${inputClassName} min-w-0 flex-1`}
                inputMode="decimal"
                onChange={event => setDensity(event.target.value)}
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
            <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Aliases</span>
            <input
              className={`${inputClassName} mt-1`}
              onChange={event => setAliases(event.target.value)}
              placeholder="flour, ap flour"
              value={aliases}
            />
            <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">Comma-separated alternate names.</span>
          </label>
          {saveMutation.error ? (
            <p className="text-sm text-red-700">{saveMutation.error.message}</p>
          ) : null}
          {deleteMutation.error ? (
            <p className="text-sm text-red-700">{deleteMutation.error.message}</p>
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
              <Button onClick={closeDialog} type="button" variant="ghost">
                Cancel
              </Button>
              <Button disabled={saveMutation.isPending || !name.trim()} type="submit">
                {saveMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>
    </section>
  )

  function openCreate() {
    setEditing(null)
    setName('')
    setDensity('')
    setAliases('')
    setDialogOpen(true)
  }

  function openEdit(item: CatalogIngredient) {
    setEditing(item)
    setName(item.name)
    setDensity(item.density_kg_m3 == null ? '' : String(item.density_kg_m3))
    setAliases(item.aliases.join(', '))
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditing(null)
  }

  function handleDelete() {
    if (!editing) {
      return
    }
    if (!window.confirm(`Delete ${titleCaseIngredient(editing.name)}?`)) {
      return
    }
    deleteMutation.mutate(editing.name)
  }

  function handleSave(event: FormEvent) {
    event.preventDefault()
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
