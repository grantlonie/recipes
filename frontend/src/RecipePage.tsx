import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type { ChangeEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { getRecipe, getScaledRecipe } from './api'
import { useAuth } from './AuthContext'

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
  const recipeQuery = useQuery({
    enabled: Boolean(slug),
    queryFn: () => getRecipe(slug),
    queryKey: ['recipe', slug],
  })
  const [servings, setServings] = useState(1)
  const scaledQuery = useQuery({
    enabled: Boolean(slug) && servings !== recipeQuery.data?.servings,
    queryFn: () => getScaledRecipe(slug, servings),
    queryKey: ['recipe', slug, 'scale', servings],
  })
  const recipe = scaledQuery.data ?? recipeQuery.data

  useEffect(() => {
    if (recipeQuery.data) {
      setServings(recipeQuery.data.servings)
    }
  }, [recipeQuery.data])

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

      <section className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-orange-100">
        {recipe.image ? (
          <img
            alt=""
            className="max-h-[420px] w-full object-cover"
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
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                onClick={handleShare}
                type="button"
              >
                Share
              </button>
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
              {recipe.steps.map((step, index) => (
                <li className="rounded-xl bg-orange-50 p-4" key={`${step}-${index}`}>
                  <span className="mb-2 block text-sm font-semibold text-orange-700">
                    Step {index + 1}
                  </span>
                  <p className="whitespace-pre-line text-stone-800">{renderCooklangStep(step)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </article>
  )

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
