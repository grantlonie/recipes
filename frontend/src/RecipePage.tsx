import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type { ChangeEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { createGroup, getGroups, getRecipe, getScaledRecipe, updateGroup } from './api'
import { useAuth } from './AuthContext'
import type { Group } from './types'

const LOWERCASE_INGREDIENT_WORDS = new Set([
  'and',
  'as',
  'for',
  'in',
  'of',
  'or',
  'the',
  'to',
  'with',
])
const AMOUNT_PREFIX_RE =
  /((?:\b(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:bags?|bottles?|boxes?|bunch(?:es)?|cans?|cloves?|cups?|dashes?|gallons?|grams?|kg|lbs?|ml|ounces?|oz|packages?|packets?|pieces?|pinches?|pints?|pounds?|quarts?|slices?|shots?|sprigs?|sticks?|tablespoons?|tbsp|teaspoons?|tsp)(?:\s+of)?\s+)?)@([^{}@]+)\{([^}]*)\}/gi

export function RecipePage() {
  const { '*': slug = '' } = useParams()
  const { auth } = useAuth()
  const queryClient = useQueryClient()
  const recipeQuery = useQuery({
    enabled: Boolean(slug),
    queryFn: () => getRecipe(slug),
    queryKey: ['recipe', slug],
  })
  const [servings, setServings] = useState(1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => new Set())
  const [groupSearch, setGroupSearch] = useState('')
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const groupsQuery = useQuery({
    enabled: auth.authenticated,
    queryFn: getGroups,
    queryKey: ['groups'],
  })
  const scaledQuery = useQuery({
    enabled: Boolean(slug) && servings !== recipeQuery.data?.servings,
    queryFn: () => getScaledRecipe(slug, servings),
    queryKey: ['recipe', slug, 'scale', servings],
  })
  const addToGroupMutation = useMutation({
    mutationFn: (group: Group) =>
      updateGroup(group.slug, {
        recipes: group.recipes.includes(slug) ? group.recipes : [...group.recipes, slug],
        title: group.title,
      }),
    onSuccess: () => invalidateGroups(),
  })
  const createGroupMutation = useMutation({
    mutationFn: (title: string) => createGroup({ recipes: [slug], title }),
    onSuccess: () => {
      setGroupSearch('')
      setGroupMenuOpen(false)
      invalidateGroups()
    },
  })
  const recipe = scaledQuery.data ?? recipeQuery.data
  const recipeGroups = (groupsQuery.data ?? []).filter(group => group.recipes.includes(slug))
  const filteredGroups = (groupsQuery.data ?? []).filter(group =>
    group.title.toLowerCase().includes(groupSearch.trim().toLowerCase())
  )
  const trimmedGroupSearch = groupSearch.trim()
  const groupTitleExists = (groupsQuery.data ?? []).some(
    group => group.title.toLowerCase() === trimmedGroupSearch.toLowerCase()
  )

  useEffect(() => {
    if (recipeQuery.data) {
      setServings(recipeQuery.data.servings)
    }
  }, [recipeQuery.data])

  useEffect(() => {
    setCompletedSteps(new Set())
  }, [slug])

  if (recipeQuery.isLoading) {
    return <p className="rounded-2xl bg-white p-6 text-stone-600">Loading recipe...</p>
  }

  if (!recipe) {
    return <p className="rounded-2xl bg-white p-6 text-stone-600">Recipe not found.</p>
  }

  return (
    <article className="space-y-8">
      <Link className="text-sm font-medium text-orange-700 hover:underline" to="/">
        Back to recipes
      </Link>

      <section className="rounded-3xl bg-white shadow-sm ring-1 ring-orange-100">
        {recipe.image ? (
          <img
            alt=""
            className="max-h-[420px] w-full rounded-t-3xl object-cover"
            referrerPolicy="no-referrer"
            src={recipe.image}
          />
        ) : null}
        <div className="space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">{recipe.title}</h1>
              <p className="mt-2 text-stone-600">
                {recipe.cook_time ? `${recipe.cook_time} · ` : ''}
                {recipe.servings} servings
              </p>
            </div>
            <div className="flex max-w-full flex-wrap gap-2">
              <button
                className="rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                onClick={handleShare}
                type="button"
              >
                Share
              </button>
              {auth.authenticated ? (
                <div className="relative">
                  <button
                    className="rounded-full bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-200"
                    onClick={() => setGroupMenuOpen(open => !open)}
                    type="button"
                  >
                    {recipeGroups.length
                      ? `Groups (${recipeGroups.length})`
                      : 'Add to group'}
                  </button>
                  {groupMenuOpen ? (
                    <div className="absolute right-0 z-20 mt-2 w-[calc(100vw-2rem)] max-w-72 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-orange-100">
                      <label className="block">
                        <span className="sr-only">Find or create a group</span>
                        <input
                          className="w-full rounded-xl border border-orange-200 px-3 py-2 text-sm outline-none ring-orange-500 focus:ring-2"
                          onChange={event => setGroupSearch(event.target.value)}
                          placeholder="Find or create group"
                          value={groupSearch}
                        />
                      </label>
                      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                        {filteredGroups.length ? (
                          filteredGroups.map(group => {
                            const added = group.recipes.includes(slug)

                            return (
                              <button
                                className="flex w-full items-center justify-between gap-3 rounded-xl bg-orange-50 px-3 py-2 text-left text-sm hover:bg-orange-100 disabled:cursor-default disabled:opacity-70"
                                disabled={added || addToGroupMutation.isPending}
                                key={group.slug}
                                onClick={() => handleAddToGroup(group)}
                                type="button"
                              >
                                <span>{group.title}</span>
                                {added ? (
                                  <span className="text-xs font-semibold text-orange-700">
                                    Added
                                  </span>
                                ) : null}
                              </button>
                            )
                          })
                        ) : (
                          <p className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-600">
                            No matching groups.
                          </p>
                        )}
                      </div>
                      <button
                        className="mt-3 w-full rounded-xl bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
                        disabled={
                          !trimmedGroupSearch || groupTitleExists || createGroupMutation.isPending
                        }
                        onClick={handleCreateGroup}
                        type="button"
                      >
                        {createGroupMutation.isPending ? 'Creating...' : createGroupLabel()}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {recipe.original_url ? (
                <a
                  className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700"
                  href={recipe.original_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Original recipe
                </a>
              ) : null}
              {auth.authenticated ? (
                <Link
                  className="rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                  to={`/editor/recipes/${slug}`}
                >
                  Edit
                </Link>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {recipe.tags.map(tag => (
              <span
                className="rounded-full bg-orange-100 px-3 py-1 text-sm text-orange-800"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-6">
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-orange-100">
            <label className="block text-sm font-semibold text-stone-700" htmlFor="servings">
              Scale servings
            </label>
            <input
              className="mt-2 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2"
              id="servings"
              min="1"
              onChange={handleServingsChange}
              type="number"
              value={servings}
            />
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-orange-100">
            <h2 className="text-lg font-semibold">Ingredients</h2>
            <ul className="mt-4 space-y-2">
              {recipe.ingredients.map((ingredient, index) => (
                <li
                  className="flex justify-between gap-3 text-sm"
                  key={`${ingredient.name}-${index}`}
                >
                  <span>{titleCaseIngredient(ingredient.name)}</span>
                  <span className="text-right text-stone-600">
                    {ingredient.scaled_quantity ?? ingredient.quantity ?? ''}
                    {ingredient.unit ? ` ${ingredient.unit}` : ''}
                    {ingredient.fixed ? ' fixed' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {recipe.cookware.length ? (
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-orange-100">
              <h2 className="text-lg font-semibold">Cookware</h2>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-stone-700">
                {recipe.cookware.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <div className="space-y-6">
          {recipe.notes.length ? (
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-orange-100">
              <h2 className="text-lg font-semibold">Notes</h2>
              <div className="mt-3 space-y-3 text-stone-700">
                {recipe.notes.map(note => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-orange-100">
            <h2 className="text-lg font-semibold">Steps</h2>
            <ol className="mt-4 space-y-4">
              {recipe.steps.map((step, index) => {
                const completed = completedSteps.has(index)
                const checkboxId = `step-${index + 1}-complete`

                return (
                  <li
                    className={`rounded-xl bg-orange-50 p-4 transition-all ${
                      completed ? 'py-2' : ''
                    }`}
                    key={`${step}-${index}`}
                  >
                    <label
                      className={`flex cursor-pointer items-center gap-3 text-sm font-semibold text-orange-700 ${
                        completed ? '' : 'mb-2'
                      }`}
                      htmlFor={checkboxId}
                    >
                      <input
                        checked={completed}
                        className="h-4 w-4 rounded border-orange-300 text-orange-600 accent-orange-600"
                        id={checkboxId}
                        onChange={() => toggleStepCompletion(index)}
                        type="checkbox"
                      />
                      <span>Step {index + 1}</span>
                    </label>
                    {completed ? null : (
                      <p className="whitespace-pre-line text-stone-800">
                        {renderCooklangStep(step)}
                      </p>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        </div>
      </div>
    </article>
  )

  function toggleStepCompletion(index: number) {
    setCompletedSteps(current => {
      const next = new Set(current)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  function handleServingsChange(event: ChangeEvent<HTMLInputElement>) {
    if (!recipe) {
      return
    }
    setServings(Number(event.target.value) || recipe.servings)
  }

  async function handleShare() {
    if (!recipe) {
      return
    }
    const shareData = { title: recipe.title, url: recipe.public_url }
    if (navigator.share) {
      await navigator.share(shareData)
      return
    }
    await navigator.clipboard.writeText(recipe.public_url)
  }

  async function handleAddToGroup(group: Group) {
    await addToGroupMutation.mutateAsync(group)
    setGroupSearch('')
    setGroupMenuOpen(false)
  }

  async function handleCreateGroup() {
    if (!trimmedGroupSearch || groupTitleExists) {
      return
    }
    await createGroupMutation.mutateAsync(trimmedGroupSearch)
  }

  function createGroupLabel() {
    if (!trimmedGroupSearch) {
      return 'Create new group'
    }
    if (groupTitleExists) {
      return 'Group already exists'
    }
    return `Create "${trimmedGroupSearch}"`
  }

  function invalidateGroups() {
    queryClient.invalidateQueries({ queryKey: ['groups'] })
  }
}

function titleCaseIngredient(value: string) {
  let wordIndex = 0

  return value.replace(/[A-Za-z][A-Za-z']*/g, word => {
    const lower = word.toLowerCase()
    const formatted =
      wordIndex > 0 && LOWERCASE_INGREDIENT_WORDS.has(lower)
        ? lower
        : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
    wordIndex += 1
    return formatted
  })
}

function renderCooklangStep(step: string) {
  const rendered: ReactNode[] = []
  let cursor = 0
  let markerIndex = 0

  AMOUNT_PREFIX_RE.lastIndex = 0
  for (const match of step.matchAll(AMOUNT_PREFIX_RE)) {
    const [marker, prefix, name, amount] = match
    const matchIndex = match.index ?? 0
    if (matchIndex > cursor) {
      rendered.push(step.slice(cursor, matchIndex))
    }

    const normalizedPrefix = prefix.replace(/\s+of\s+$/i, ' ')
    const ingredient = normalizedPrefix
      ? `${normalizedPrefix}${name.trim()}`
      : formatIngredientPhrase(name.trim(), amount)
    rendered.push(
      <span
        className="inline rounded-md border border-orange-200 bg-orange-100/70 px-1 font-semibold text-stone-900"
        key={`${matchIndex}-${markerIndex}`}
      >
        {ingredient}
      </span>
    )
    cursor = matchIndex + marker.length
    markerIndex += 1
  }

  if (cursor < step.length) {
    rendered.push(step.slice(cursor))
  }

  return rendered.length ? rendered : step
}

function formatIngredientPhrase(name: string, amount: string) {
  const { quantity, unit } = splitAmount(amount)
  if (!quantity) {
    return name
  }
  if (!unit) {
    return `${quantity} ${name}`
  }
  return `${quantity} ${unit} ${name}`
}

function splitAmount(amount: string) {
  const [quantity, unit] = amount.split('%', 2).map(part => part.trim())
  return { quantity: quantity?.replace(/^=/, '') ?? '', unit: unit ?? '' }
}
