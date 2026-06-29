import { Link } from 'react-router-dom'
import type { ChangeEvent, UIEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { BookmarkIcon as BookmarkIconOutline } from '@heroicons/react/24/outline'
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid'

import { getAllStoredRecipes, getLocalSummaries } from './db'
import { useAuth } from './AuthContext'
import { TagMultiSelect } from './components/TagMultiSelect'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { searchRecipes } from './search'
import type { RecipeDetail, RecipeSummary } from './types'

export function HomePage() {
  const { auth } = useAuth()
  const { revision, status, sync } = useRecipeSync()
  const {
    activeTags,
    bookmarkedOnly,
    query,
    recentRecipes,
    scrollTop,
    setActiveTags,
    setBookmarkedOnly,
    setQuery,
    setScrollTop,
  } = useRecipeListState()
  const recipesScrollRef = useRef<HTMLDivElement | null>(null)
  const [summaries, setSummaries] = useState<RecipeSummary[]>([])
  const [details, setDetails] = useState<RecipeDetail[]>([])
  const [localReady, setLocalReady] = useState(false)
  const searchQuery = query.trim()
  const showSearchResults = searchQuery.length > 0
  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const recipe of summaries) {
      for (const tag of recipe.tags) {
        tags.add(tag)
      }
    }
    return [...tags].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    )
  }, [summaries])
  const bookmarkedRecipes = useMemo(
    () => filterRecipes(summaries, true, activeTags),
    [activeTags, summaries],
  )
  const recipes = useMemo(() => {
    if (!showSearchResults) {
      return []
    }
    return filterRecipes(
      searchRecipes(summaries, details, searchQuery),
      bookmarkedOnly,
      activeTags,
    )
  }, [activeTags, bookmarkedOnly, details, searchQuery, showSearchResults, summaries])

  useEffect(() => {
    sync()
  }, [sync])

  useEffect(() => {
    let cancelled = false
    Promise.all([getLocalSummaries(), getAllStoredRecipes()]).then(([nextSummaries, stored]) => {
      if (cancelled) {
        return
      }
      setSummaries(nextSummaries)
      setDetails(stored.map(record => record.recipe))
      setLocalReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [revision])

  useEffect(() => {
    if (recipesScrollRef.current) {
      recipesScrollRef.current.scrollTop = scrollTop
    }
  }, [recipes.length, scrollTop])

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col sm:h-[calc(100vh-6rem)]">
      <section className="shrink-0 space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-orange-100">
        <label className="block">
          <span className="sr-only">Search recipes</span>
          <input
            className="w-full rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-lg outline-none ring-orange-500 focus:ring-2"
            onChange={handleQueryChange}
            onFocus={event => event.target.select()}
            placeholder="Search by name, tags, ingredients, or recipe text"
            type="search"
            value={query}
          />
        </label>
        <div className="flex items-start gap-3">
          <button
            aria-label={bookmarkedOnly ? 'Show all recipes' : 'Show bookmarked recipes'}
            className="inline-flex shrink-0 items-center justify-center p-1 text-orange-600 transition hover:text-orange-700"
            onClick={() => setBookmarkedOnly(!bookmarkedOnly)}
            type="button"
          >
            {bookmarkedOnly ? (
              <BookmarkIconSolid aria-hidden="true" className="h-6 w-6" />
            ) : (
              <BookmarkIconOutline aria-hidden="true" className="h-6 w-6" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <TagMultiSelect
              availableTags={availableTags}
              onChange={setActiveTags}
              placeholder="Filter by tags"
              value={activeTags}
            />
          </div>
        </div>
      </section>

      {!showSearchResults ? (
        bookmarkedOnly ? (
          bookmarkedRecipes.length ? (
            <CompactRecipeGrid recipes={bookmarkedRecipes} title="Bookmarked" />
          ) : (
            <p className="shrink-0 pt-5 text-sm text-stone-600">No bookmarked recipes yet.</p>
          )
        ) : (
          <CompactRecipeGrid recipes={recentRecipes} title="Recently Viewed" />
        )
      ) : null}

      <section
        className="min-h-0 flex-1 overflow-y-auto pr-1 pt-5"
        onScroll={handleRecipesScroll}
        ref={recipesScrollRef}
      >
        {showSearchResults ? (
          !localReady ? (
            <p className="rounded-2xl bg-white p-6 text-stone-600">Loading recipes...</p>
          ) : recipes.length ? (
            <CompactRecipeGrid recipes={recipes} />
          ) : status === 'syncing' && !summaries.length ? (
            <p className="rounded-2xl bg-white p-6 text-stone-600">Syncing recipes...</p>
          ) : (
            <p className="rounded-2xl bg-white p-6 text-stone-600">No recipes found.</p>
          )
        ) : null}
      </section>

      <Link
        className="fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-orange-600 text-3xl font-light text-white shadow-lg hover:bg-orange-700"
        to={auth.authenticated ? '/recipes/new' : '/login'}
      >
        <span className="sr-only">New recipe</span>
        +
      </Link>
    </div>
  )

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value)
  }

  function handleRecipesScroll(event: UIEvent<HTMLDivElement>) {
    setScrollTop(event.currentTarget.scrollTop)
  }
}

function CompactRecipeGrid({ recipes, title }: CompactRecipeGridProps) {
  if (!recipes.length) {
    return null
  }

  return (
    <div className={title ? 'shrink-0 pt-5' : undefined}>
      {title ? (
        <h2 className="text-sm font-bold uppercase tracking-wide text-stone-700">{title}</h2>
      ) : null}
      <div className={`grid grid-cols-3 gap-3 ${title ? 'mt-2' : ''}`}>
        {recipes.map(recipe => (
          <CompactRecipeTile key={recipe.slug} recipe={recipe} />
        ))}
      </div>
    </div>
  )
}

function CompactRecipeTile({ recipe }: CompactRecipeTileProps) {
  return (
    <Link className="min-w-0" to={`/recipes/${recipe.slug}`}>
      {recipe.image ? (
        <img
          alt=""
          className="aspect-square w-full rounded-xl object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={recipe.image}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-orange-100">
          <img alt="" className="h-16 w-16 object-contain opacity-90" src="/web-app-icon-512.png" />
        </div>
      )}
      <p className="mt-1 line-clamp-2 text-sm font-semibold leading-tight">{recipe.title}</p>
    </Link>
  )
}

interface CompactRecipeGridProps {
  recipes: RecipeSummary[]
  title?: string
}

interface CompactRecipeTileProps {
  recipe: RecipeSummary
}

function filterRecipes(recipes: RecipeSummary[], bookmarkedOnly: boolean, activeTags: string[]) {
  return recipes.filter(recipe => {
    if (bookmarkedOnly && !recipe.bookmarked) {
      return false
    }
    if (activeTags.some(tag => !recipe.tags.includes(tag))) {
      return false
    }
    return true
  })
}
