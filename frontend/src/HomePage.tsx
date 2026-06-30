import { Link } from 'react-router-dom'
import type { UIEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { updateRecipeMetadata } from './api'
import { getAllStoredRecipes, getLocalSummaries } from './db'
import { useAuth } from './AuthContext'
import { BookmarkButton } from './components/BookmarkButton'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { searchRecipes } from './search'
import { storeRecipe } from './sync'
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
    setScrollTop,
  } = useRecipeListState()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollRestoringRef = useRef(false)
  const filterKey = `${query}|${activeTags.join(',')}|${bookmarkedOnly}`
  const [summaries, setSummaries] = useState<RecipeSummary[]>([])
  const [details, setDetails] = useState<RecipeDetail[]>([])
  const [localReady, setLocalReady] = useState(false)
  const bookmarkMutation = useMutation({
    mutationFn: ({ bookmarked, slug }: BookmarkInput) =>
      updateRecipeMetadata(slug, { bookmarked: !bookmarked }),
    onSuccess: async recipe => {
      await storeRecipe(recipe)
      await sync()
      setSummaries(current =>
        current.map(summary =>
          summary.slug === recipe.slug ? summaryFromDetail(recipe) : summary,
        ),
      )
      setDetails(current =>
        current.map(detail => (detail.slug === recipe.slug ? recipe : detail)),
      )
    },
  })
  const handleBookmarkToggle = useCallback(
    (recipe: RecipeSummary) => {
      bookmarkMutation.mutate({ bookmarked: recipe.bookmarked, slug: recipe.slug })
    },
    [bookmarkMutation],
  )
  const searchQuery = query.trim()
  const showSearchResults = searchQuery.length > 0
  const bookmarkedRecipes = useMemo(
    () => filterRecipes(summaries, true, activeTags),
    [activeTags, summaries],
  )
  const displayRecentRecipes = useMemo(() => {
    const bySlug = new Map(summaries.map(summary => [summary.slug, summary]))
    return recentRecipes.map(recipe => bySlug.get(recipe.slug) ?? recipe)
  }, [recentRecipes, summaries])
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="home-scroll h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 pt-2"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {!showSearchResults ? (
          bookmarkedOnly ? (
            bookmarkedRecipes.length ? (
              <CompactRecipeGrid
                bookmarkPendingSlug={
                  bookmarkMutation.isPending ? bookmarkMutation.variables?.slug : undefined
                }
                onBookmarkToggle={handleBookmarkToggle}
                recipes={bookmarkedRecipes}
                title="Bookmarked"
              />
            ) : (
              <p className="text-sm text-stone-600">No bookmarked recipes yet.</p>
            )
          ) : (
            <CompactRecipeGrid
              bookmarkPendingSlug={
                bookmarkMutation.isPending ? bookmarkMutation.variables?.slug : undefined
              }
              onBookmarkToggle={handleBookmarkToggle}
              recipes={displayRecentRecipes}
              title="Recently Viewed"
            />
          )
        ) : !localReady ? (
          <p className="text-stone-600">Loading recipes...</p>
        ) : recipes.length ? (
          <CompactRecipeGrid
            bookmarkPendingSlug={
              bookmarkMutation.isPending ? bookmarkMutation.variables?.slug : undefined
            }
            onBookmarkToggle={handleBookmarkToggle}
            recipes={recipes}
          />
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

function CompactRecipeGrid({
  bookmarkPendingSlug,
  onBookmarkToggle,
  recipes,
  title,
}: CompactRecipeGridProps) {
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
          <CompactRecipeTile
            bookmarkPending={bookmarkPendingSlug === recipe.slug}
            key={recipe.slug}
            onBookmarkToggle={onBookmarkToggle}
            recipe={recipe}
          />
        ))}
      </div>
    </div>
  )
}

function CompactRecipeTile({
  bookmarkPending,
  onBookmarkToggle,
  recipe,
}: CompactRecipeTileProps) {
  const { auth } = useAuth()

  return (
    <Link className="relative block min-w-0" to={`/recipes/${recipe.slug}`}>
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
      {auth.authenticated ? (
        <BookmarkButton
          bookmarked={recipe.bookmarked}
          className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 shadow-sm backdrop-blur-sm"
          disabled={bookmarkPending}
          iconClassName="h-4 w-4"
          onToggle={() => onBookmarkToggle(recipe)}
        />
      ) : null}
      <p className="mt-1 line-clamp-2 text-sm font-semibold leading-tight">{recipe.title}</p>
    </Link>
  )
}

interface BookmarkInput {
  bookmarked: boolean
  slug: string
}

interface CompactRecipeGridProps {
  bookmarkPendingSlug?: string
  onBookmarkToggle: (recipe: RecipeSummary) => void
  recipes: RecipeSummary[]
  title?: string
}

interface CompactRecipeTileProps {
  bookmarkPending?: boolean
  onBookmarkToggle: (recipe: RecipeSummary) => void
  recipe: RecipeSummary
}

function summaryFromDetail(recipe: RecipeDetail): RecipeSummary {
  return {
    bookmarked: recipe.bookmarked,
    cook_time: recipe.cook_time,
    image: recipe.image,
    notes: recipe.notes,
    original_url: recipe.original_url,
    servings: recipe.servings,
    slug: recipe.slug,
    tags: recipe.tags,
    title: recipe.title,
  }
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
