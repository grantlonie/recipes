import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'

import { ArrowTopRightOnSquareIcon, ShareIcon } from '@heroicons/react/24/outline'

import { deleteRecipe, getScaledRecipe, updateRecipeMetadata } from './api'
import { useAuth } from './AuthContext'
import { BookmarkButton } from './components/BookmarkButton'
import { Button } from './components/Button'
import { Popover } from './components/Popover'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { loadRecipeStaleFirst, revalidateRecipe, storeRecipe } from './sync'

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
  const { revision, sync } = useRecipeSync()
  const recipeQuery = useQuery({
    enabled: Boolean(slug),
    queryFn: () =>
      loadRecipeStaleFirst(slug, updated =>
        queryClient.setQueryData(['recipe', slug], updated),
      ),
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
    onSuccess: async recipe => {
      queryClient.setQueryData(['recipe', slug], recipe)
      await storeRecipe(recipe)
      await sync()
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteRecipe(slug),
    onSuccess: async () => {
      await sync()
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

  useEffect(() => {
    if (!slug || revision === 0) {
      return
    }
    revalidateRecipe(slug).then(updated => {
      if (updated) {
        queryClient.setQueryData(['recipe', slug], updated)
      }
    })
  }, [queryClient, revision, slug])

  if (recipeQuery.isLoading && !recipeQuery.data) {
    return <p className="rounded-2xl bg-white p-6 text-stone-600">Loading recipe...</p>
  }

  if (!recipe) {
    return <p className="rounded-2xl bg-white p-6 text-stone-600">Recipe not found.</p>
  }

  return (
    <article className="space-y-8 pb-8">
      <section className="rounded-3xl bg-white shadow-sm ring-1 ring-orange-100">
        {recipe.image ? (
          <img
            alt=""
            className="h-[250px] w-full rounded-t-3xl object-cover sm:h-auto sm:max-h-[420px]"
            referrerPolicy="no-referrer"
            src={recipe.image}
          />
        ) : null}
        <div className="space-y-5 p-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{recipe.title}</h1>
            <p className="mt-1 text-sm text-stone-600">
              {recipe.cook_time ? `${recipe.cook_time} · ` : ''}
              {recipe.servings} servings
            </p>
          </div>
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
            <div
              aria-label="Scale servings"
              className="flex shrink-0 items-stretch overflow-hidden rounded-full border border-orange-200 text-xs"
              role="group"
            >
              <button
                aria-label="Decrease servings"
                className="flex w-7 shrink-0 items-center justify-center bg-orange-50 font-semibold text-orange-800 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={servings <= 1}
                id="servings-decrease"
                onClick={() => setServings(current => Math.max(1, current - 1))}
                type="button"
              >
                −
              </button>
              <output
                aria-live="polite"
                className="flex min-w-7 items-center justify-center border-x border-orange-200 px-2 py-1.5 font-semibold tabular-nums text-stone-900"
                id="servings"
              >
                {servings}
              </output>
              <button
                aria-label="Increase servings"
                className="flex w-7 shrink-0 items-center justify-center bg-orange-50 font-semibold text-orange-800 transition hover:bg-orange-100"
                id="servings-increase"
                onClick={() => setServings(current => current + 1)}
                type="button"
              >
                +
              </button>
            </div>
            <button
              aria-label="Share recipe"
              className="inline-flex shrink-0 items-center justify-center rounded-full p-2 text-orange-600 transition hover:bg-orange-100 hover:text-orange-700"
              onClick={handleShare}
              type="button"
            >
              <ShareIcon aria-hidden="true" className="h-5 w-5" />
            </button>
            {recipe.original_url ? (
              <a
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-orange-100 hover:text-orange-800"
                href={recipe.original_url}
                rel="noreferrer"
                target="_blank"
              >
                <ArrowTopRightOnSquareIcon aria-hidden="true" className="h-4 w-4" />
                Source
              </a>
            ) : null}
            {auth.authenticated ? (
              <>
                <BookmarkButton
                  bookmarked={recipe.bookmarked}
                  className="shrink-0"
                  disabled={bookmarkMutation.isPending}
                  onToggle={handleToggleBookmark}
                />
                <Popover
                  open={actionsOpen}
                  trigger={
                    <Button
                      aria-label="Recipe actions"
                      className="shrink-0 px-3 text-xl leading-none"
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
            <h2 className="text-lg font-semibold">Ingredients</h2>
            <ul className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              {recipe.ingredients.map((ingredient, index) => (
                <Fragment key={`${ingredient.name}-${index}`}>
                  <span className="tabular-nums text-stone-600">
                    {ingredient.scaled_quantity ?? ingredient.quantity ?? ''}
                    {ingredient.unit ? ` ${ingredient.unit}` : ''}
                    {ingredient.fixed ? ' fixed' : ''}
                  </span>
                  <span>{titleCaseIngredient(ingredient.name)}</span>
                </Fragment>
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
                  <ExpandableNote key={note} text={note} />
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

function ExpandableNote({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const element = textRef.current
    if (!element || expanded) {
      return
    }
    setClamped(element.scrollHeight > element.clientHeight + 1)
  }, [expanded, text])

  return (
    <div>
      <p className={expanded ? undefined : 'line-clamp-4'} ref={textRef}>
        {text}
      </p>
      {clamped || expanded ? (
        <button
          className="mt-2 text-sm font-semibold text-orange-700 hover:underline"
          onClick={() => setExpanded(current => !current)}
          type="button"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
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
