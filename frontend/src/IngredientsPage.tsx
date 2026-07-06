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
import { useIngredientCatalog } from './IngredientCatalogContext'
import type { CatalogIngredient } from './types'

const inputClassName =
  'w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2'

export function IngredientsPage() {
  const { auth } = useAuth()
  const queryClient = useQueryClient()
  const { ingredients, refresh } = useIngredientCatalog()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CatalogIngredient | null>(null)
  const [name, setName] = useState('')
  const [density, setDensity] = useState('')
  const [aliases, setAliases] = useState('')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return ingredients
    }
    return ingredients.filter(
      item =>
        item.name.toLowerCase().includes(needle) ||
        item.aliases.some(alias => alias.toLowerCase().includes(needle)),
    )
  }, [ingredients, query])

  const saveMutation = useMutation({
    mutationFn: (ingredient: CatalogIngredient) => upsertIngredient(ingredient),
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
    },
  })

  if (!auth.authenticated) {
    return (
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <p className="mt-2 text-stone-600">Editor access is required to manage ingredients.</p>
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
    <section className="space-y-6">
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">Catalog</p>
            <h1 className="mt-1 text-3xl font-bold">Ingredients</h1>
            <p className="mt-2 max-w-2xl text-sm text-stone-600">
              Densities are stored as kg/m³. Leave density blank to show weight (lb/oz) in US mode.
            </p>
          </div>
          <Button onClick={() => openCreate()}>Add ingredient</Button>
        </div>

        <label className="mt-6 block">
          <span className="sr-only">Search ingredients</span>
          <input
            className={inputClassName}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search ingredients"
            type="search"
            value={query}
          />
        </label>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-orange-100 text-stone-500">
              <tr>
                <th className="py-2 pr-4 font-semibold">Name</th>
                <th className="py-2 pr-4 font-semibold">Density (kg/m³)</th>
                <th className="py-2 pr-4 font-semibold">Aliases</th>
                <th className="py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr className="border-b border-orange-50" key={item.name}>
                  <td className="py-3 pr-4 font-medium text-stone-900">{item.name}</td>
                  <td className="py-3 pr-4 tabular-nums text-stone-700">
                    {item.density_kg_m3 ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-stone-600">{item.aliases.join(', ') || '—'}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => openEdit(item)} variant="secondary">
                        Edit
                      </Button>
                      <Button
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(item.name)}
                        variant="danger"
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? (
            <p className="mt-4 text-sm text-stone-500">No ingredients match your search.</p>
          ) : null}
        </div>
      </div>

      <Dialog labelledBy="ingredient-catalog-dialog-title" open={dialogOpen}>
        <h2 className="text-xl font-bold" id="ingredient-catalog-dialog-title">
          {editing ? 'Edit ingredient' : 'Add ingredient'}
        </h2>
        <form className="mt-4 space-y-4" onSubmit={handleSave}>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700">Name</span>
            <input
              className={`${inputClassName} mt-1`}
              onChange={event => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700">Density (kg/m³)</span>
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
            <span className="mt-1 block text-xs text-stone-500">
              Leave blank to show weight (lb/oz) in US mode. Water is 1000.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700">Aliases</span>
            <input
              className={`${inputClassName} mt-1`}
              onChange={event => setAliases(event.target.value)}
              placeholder="flour, ap flour"
              value={aliases}
            />
            <span className="mt-1 block text-xs text-stone-500">Comma-separated alternate names.</span>
          </label>
          {saveMutation.error ? (
            <p className="text-sm text-red-700">{saveMutation.error.message}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={closeDialog} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={saveMutation.isPending || !name.trim()} type="submit">
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
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

  function handleSave(event: FormEvent) {
    event.preventDefault()
    const densityValue = density.trim()
    const parsedDensity = densityValue ? Number(densityValue) : null
    if (densityValue && Number.isNaN(parsedDensity)) {
      return
    }
    saveMutation.mutate({
      aliases: aliases
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
      density_kg_m3: parsedDensity,
      name: name.trim(),
    })
  }
}
