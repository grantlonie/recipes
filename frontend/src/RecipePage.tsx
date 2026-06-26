import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { deleteRecipe, getRecipe, getScaledRecipe, updateRecipeMetadata } from './api'
import { useAuth } from './AuthContext'
import { BookmarkButton } from './components/BookmarkButton'
import { Button } from './components/Button'
import { Popover } from './components/Popover'
import { useRecipeListState } from './RecipeListContext'

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
const COOKWARE_RE = /#([^{}#]+)\{\}/g
const TIMER_RE = /~([A-Za-z0-9_./' -]*?)\{([^}]*)\}/g

export function RecipePage() {
  const { '*': slug = '' } = useParams()
  const { auth } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { addRecentRecipe } = useRecipeListState()
  const recipeQuery = useQuery({
    enabled: Boolean(slug),
    queryFn: () => getRecipe(slug),
    queryKey: ['recipe', slug],
  })
  const [servings, setServings] = useState(1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => new Set())
  const [actionsOpen, setActionsOpen] = useState(false)
  const scaledQuery = useQuery({
    enabled: Boolean(slug) && servings !== recipeQuery.data?.servings,
    queryFn: () => getScaledRecipe(slug, servings),
    queryKey: ['recipe', slug, 'scale', servings],
  })
  const bookmarkMutation = useMutation({
    mutationFn: () => updateRecipeMetadata(slug, { bookmarked: !recipeQuery.data?.bookmarked }),
    onSuccess: recipe => {
      queryClient.setQueryData(['recipe', slug], recipe)
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteRecipe(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      navigate('/')
    },
  })
  const recipe = scaledQuery.data ?? recipeQuery.data

  useEffect(() => {
    if (recipeQuery.data) {
      setServings(recipeQuery.data.servings)
      addRecentRecipe(recipeQuery.data)
    }
  }, [addRecentRecipe, recipeQuery.data])

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
            <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
              <Button onClick={handleShare}>
                Share
              </Button>
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
                <>
                  <BookmarkButton
                    bookmarked={recipe.bookmarked}
                    disabled={bookmarkMutation.isPending}
                    onToggle={handleToggleBookmark}
                  />
                  <Popover
                    open={actionsOpen}
                    trigger={
                      <Button
                        aria-label="Recipe actions"
                        className="px-3 text-xl leading-none"
                        onClick={() => setActionsOpen(open => !open)}
                        variant="secondary"
                      >
                        ...
                      </Button>
                    }
                  >
                    <Link
                      className="block rounded-xl px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-orange-50"
                      to={`/recipes/edit/${slug}`}
                    >
                      Edit
                    </Link>
                    <button
                      className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"
                      disabled={deleteMutation.isPending}
                      onClick={handleDelete}
                      type="button"
                    >
                      {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                    </button>
                  </Popover>
                </>
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
            <p className="text-sm font-semibold text-stone-700" id="servings-label">
              Scale servings
            </p>
            <div
              aria-labelledby="servings-label"
              className="mt-2 flex items-stretch overflow-hidden rounded-xl border border-orange-200"
              role="group"
            >
              <button
                aria-label="Decrease servings"
                className="flex w-12 shrink-0 items-center justify-center bg-orange-50 text-xl font-semibold text-orange-800 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={servings <= 1}
                id="servings-decrease"
                onClick={() => setServings(current => Math.max(1, current - 1))}
                type="button"
              >
                −
              </button>
              <output
                aria-live="polite"
                className="flex flex-1 items-center justify-center border-x border-orange-200 px-3 py-2 text-sm font-semibold tabular-nums text-stone-900"
                id="servings"
              >
                {servings}
              </output>
              <button
                aria-label="Increase servings"
                className="flex w-12 shrink-0 items-center justify-center bg-orange-50 text-xl font-semibold text-orange-800 transition hover:bg-orange-100"
                id="servings-increase"
                onClick={() => setServings(current => current + 1)}
                type="button"
              >
                +
              </button>
            </div>
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

  async function handleToggleBookmark() {
    if (!recipeQuery.data) {
      return
    }
    await bookmarkMutation.mutateAsync()
  }

  async function handleDelete() {
    if (!recipe) {
      return
    }
    if (!window.confirm(`Delete "${recipe.title}"? This cannot be undone.`)) {
      return
    }
    await deleteMutation.mutateAsync()
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
  const markers: StepMarker[] = []

  AMOUNT_PREFIX_RE.lastIndex = 0
  for (const match of step.matchAll(AMOUNT_PREFIX_RE)) {
    const [marker, prefix, name, amount] = match
    const matchIndex = match.index ?? 0
    const normalizedPrefix = prefix.replace(/\s+of\s+$/i, ' ')
    const ingredient = normalizedPrefix
      ? `${normalizedPrefix}${name.trim()}`
      : formatIngredientPhrase(name.trim(), amount)
    markers.push({
      index: matchIndex,
      length: marker.length,
      text: ingredient,
      type: 'ingredient',
    })
  }

  COOKWARE_RE.lastIndex = 0
  for (const match of step.matchAll(COOKWARE_RE)) {
    const [marker, name] = match
    markers.push({
      index: match.index ?? 0,
      length: marker.length,
      text: name.trim(),
      type: 'cookware',
    })
  }

  TIMER_RE.lastIndex = 0
  for (const match of step.matchAll(TIMER_RE)) {
    const [marker, name, amount] = match
    markers.push({
      index: match.index ?? 0,
      length: marker.length,
      text: formatTimerPhrase(name.trim(), amount),
      type: 'timer',
    })
  }

  markers.sort((left, right) => left.index - right.index)

  const rendered: ReactNode[] = []
  let cursor = 0
  let markerIndex = 0

  for (const marker of markers) {
    if (marker.index < cursor) {
      continue
    }
    if (marker.index > cursor) {
      rendered.push(step.slice(cursor, marker.index))
    }
    rendered.push(
      <span className={STEP_MARKER_CLASS[marker.type]} key={`${marker.index}-${markerIndex}`}>
        {marker.text}
      </span>
    )
    cursor = marker.index + marker.length
    markerIndex += 1
  }

  if (cursor < step.length) {
    rendered.push(step.slice(cursor))
  }

  return rendered.length ? rendered : step
}

const STEP_MARKER_CLASS = {
  cookware:
    'inline rounded-md border border-stone-500 bg-stone-100/90 px-1 font-bold text-stone-900',
  ingredient:
    'inline rounded-md border border-orange-200 bg-orange-100/70 px-1 font-semibold text-stone-900',
  timer:
    'inline rounded-md border border-amber-400 bg-amber-50/90 px-1 font-medium text-stone-900',
} as const

type StepMarker = {
  index: number
  length: number
  text: string
  type: keyof typeof STEP_MARKER_CLASS
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

function formatTimerPhrase(name: string, amount: string) {
  const { quantity, unit } = splitAmount(amount)
  if (name) {
    return name
  }
  if (!quantity) {
    return amount
  }
  if (!unit) {
    return quantity
  }
  return `${quantity} ${unit}`
}

function splitAmount(amount: string) {
  const [quantity, unit] = amount.split('%', 2).map(part => part.trim())
  return { quantity: quantity?.replace(/^=/, '') ?? '', unit: unit ?? '' }
}
