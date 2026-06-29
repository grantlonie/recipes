import { Link } from 'react-router-dom'
import type { UIEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

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
    setScrollTop,
  } = useRecipeListState()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollRestoringRef = useRef(false)
  const filterKey = `${query}|${activeTags.join(',')}|${bookmarkedOnly}`
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
    const element = scrollRef.current
    if (!element) {
      return
    }
    scrollRestoringRef.current = true
    element.scrollTop = scrollTop
    requestAnimationFrame(() => {
      scrollRestoringRef.current = false
    })
    // Restore scroll when returning to the home view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    scrollRestoringRef.current = true
    element.scrollTop = 0
    requestAnimationFrame(() => {
      scrollRestoringRef.current = false
    })
  }, [filterKey])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 pb-2">
        <TagMultiSelect
          availableTags={availableTags}
          onChange={setActiveTags}
          placeholder="Filter by tags"
          value={activeTags}
        />
      </div>

      <div
        className="home-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {!showSearchResults ? (
          bookmarkedOnly ? (
            bookmarkedRecipes.length ? (
              <CompactRecipeGrid recipes={bookmarkedRecipes} title="Bookmarked" />
            ) : (
              <p className="text-sm text-stone-600">No bookmarked recipes yet.</p>
            )
          ) : (
            <CompactRecipeGrid recipes={recentRecipes} title="Recently Viewed" />
          )
        ) : !localReady ? (
          <p className="text-stone-600">Loading recipes...</p>
        ) : recipes.length ? (
          <CompactRecipeGrid recipes={recipes} />
        ) : status === 'syncing' && !summaries.length ? (
          <p className="text-stone-600">Syncing recipes...</p>
        ) : (
          <p className="text-stone-600">No recipes found.</p>
        )}
      </div>

      <Link
        className="fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-orange-600 text-3xl font-light text-white shadow-lg hover:bg-orange-700"
        to={auth.authenticated ? '/recipes/new' : '/login'}
      >
        <span className="sr-only">New recipe</span>
        +
      </Link>
    </div>
  )

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (scrollRestoringRef.current) {
      return
    }
    setScrollTop(event.currentTarget.scrollTop)
  }
}

function CompactRecipeGrid({ recipes, title }: CompactRecipeGridProps) {
  if (!recipes.length) {
    return null
  }

  return (
    <div>
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
