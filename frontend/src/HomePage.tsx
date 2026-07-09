import type { ReactNode } from 'react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'

import { updateRecipeMetadata } from './api'
import { getAllStoredRecipes, getLocalSummaries } from './db'
import { useAuth } from './AuthContext'
import { BookmarkButton } from './components/BookmarkButton'
import { Button } from './components/Button'
import { NewRecipeFab } from './components/NewRecipeFab'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { searchRecipes } from './search'
import { storeRecipe } from './sync'
import type { RecipeDetail, RecipeSummary } from './types'

export function HomePage({ isVisible }: HomePageProps) {
  const { revision, status, sync } = useRecipeSync()
  const {
    activeTags,
    bookmarkedOnly,
    query,
    recentRecipes,
    scrollTop,
    setScrollTop,
  } = useRecipeListState()
  const scrollRestoringRef = useRef(false)
  const [showAllRecipes, setShowAllRecipes] = useState(false)
  const filterKey = `${query}|${activeTags.join(',')}|${bookmarkedOnly}|${showAllRecipes}`
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
    return recentRecipes
      .map(recipe => bySlug.get(recipe.slug) ?? recipe)
      .filter(recipe => !localReady || bySlug.has(recipe.slug))
  }, [localReady, recentRecipes, summaries])
  const taggedRecipes = useMemo(
    () => filterRecipes(summaries, false, activeTags),
    [activeTags, summaries],
  )
  const hasTagFilter = activeTags.length > 0
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

  useLayoutEffect(() => {
    if (!isVisible) {
      return
    }
    scrollRestoringRef.current = true
    window.scrollTo(0, scrollTop)
    requestAnimationFrame(() => {
      scrollRestoringRef.current = false
    })
  }, [isVisible, scrollTop])

  useEffect(() => {
    if (!isVisible) {
      return
    }
    scrollRestoringRef.current = true
    window.scrollTo(0, 0)
    requestAnimationFrame(() => {
      scrollRestoringRef.current = false
    })
  }, [filterKey, isVisible])

  useEffect(() => {
    if (!isVisible) {
      return
    }
    function handleScroll() {
      if (scrollRestoringRef.current) {
        return
      }
      setScrollTop(window.scrollY)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [isVisible, setScrollTop])

  return (
    <>
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
              <p className="text-sm text-stone-600 dark:text-stone-400">No bookmarked recipes yet.</p>
            )
          ) : hasTagFilter ? (
            taggedRecipes.length ? (
              <CompactRecipeGrid
                bookmarkPendingSlug={
                  bookmarkMutation.isPending ? bookmarkMutation.variables?.slug : undefined
                }
                onBookmarkToggle={handleBookmarkToggle}
                recipes={taggedRecipes}
              />
            ) : (
              <p className="text-sm text-stone-600 dark:text-stone-400">No recipes match these tags.</p>
            )
          ) : summaries.length || displayRecentRecipes.length ? (
            <CompactRecipeGrid
              bookmarkPendingSlug={
                bookmarkMutation.isPending ? bookmarkMutation.variables?.slug : undefined
              }
              headerAction={
                summaries.length ? (
                  <Button
                    className="px-3 py-1"
                    onClick={() => setShowAllRecipes(current => !current)}
                    variant="ghost"
                  >
                    {showAllRecipes ? 'Recently viewed' : 'View all'}
                  </Button>
                ) : undefined
              }
              onBookmarkToggle={handleBookmarkToggle}
              recipes={showAllRecipes ? summaries : displayRecentRecipes}
              title={showAllRecipes ? 'All Recipes' : 'Recently Viewed'}
            />
          ) : (
            <p className="text-sm text-stone-600 dark:text-stone-400">No recipes yet.</p>
          )
        ) : !localReady ? (
          <p className="text-stone-600 dark:text-stone-400">Loading recipes...</p>
        ) : recipes.length ? (
          <CompactRecipeGrid
            bookmarkPendingSlug={
              bookmarkMutation.isPending ? bookmarkMutation.variables?.slug : undefined
            }
            onBookmarkToggle={handleBookmarkToggle}
            recipes={recipes}
          />
        ) : status === 'syncing' && !summaries.length ? (
          <p className="text-stone-600 dark:text-stone-400">Syncing recipes...</p>
        ) : (
          <p className="text-stone-600 dark:text-stone-400">No recipes found.</p>
        )}

      <NewRecipeFab />
    </>
  )
}

function CompactRecipeGrid({
  bookmarkPendingSlug,
  headerAction,
  onBookmarkToggle,
  recipes,
  title,
}: CompactRecipeGridProps) {
  const tiles = useMemo(() => uniqueRecipesForGrid(recipes), [recipes])

  if (!tiles.length && !headerAction) {
    return null
  }

  return (
    <div>
      {title || headerAction ? (
        <div className="flex items-center justify-between gap-2">
          {title ? (
            <h2 className="text-sm font-bold uppercase tracking-wide text-stone-700 dark:text-stone-300">{title}</h2>
          ) : (
            <span />
          )}
          {headerAction}
        </div>
      ) : null}
      <div className={`grid grid-cols-3 gap-3 ${title || headerAction ? 'mt-2' : ''}`}>
        {tiles.map(({ key, recipe }) => (
          <CompactRecipeTile
            key={key}
            bookmarkPending={bookmarkPendingSlug === recipe.slug}
            onBookmarkToggle={onBookmarkToggle}
            recipe={recipe}
          />
        ))}
      </div>
    </div>
  )
}

const CompactRecipeTile = memo(function CompactRecipeTile({
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
          decoding="async"
          referrerPolicy="no-referrer"
          src={recipe.image}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-orange-100 dark:bg-stone-800">
          <img alt="" className="h-16 w-16 object-contain opacity-90" src="/web-app-icon-512.png" />
        </div>
      )}
      {auth.authenticated ? (
        <BookmarkButton
          bookmarked={recipe.bookmarked}
          className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 shadow-sm backdrop-blur-sm dark:bg-stone-900/90"
          disabled={bookmarkPending}
          iconClassName="h-4 w-4"
          onToggle={() => onBookmarkToggle(recipe)}
        />
      ) : null}
      <p className="mt-1 line-clamp-2 text-sm font-semibold leading-tight text-stone-900 dark:text-stone-100">{recipe.title}</p>
    </Link>
  )
})

interface BookmarkInput {
  bookmarked: boolean
  slug: string
}

interface CompactRecipeGridProps {
  bookmarkPendingSlug?: string
  headerAction?: ReactNode
  onBookmarkToggle: (recipe: RecipeSummary) => void
  recipes: RecipeSummary[]
  title?: string
}

interface CompactRecipeTileProps {
  bookmarkPending?: boolean
  onBookmarkToggle: (recipe: RecipeSummary) => void
  recipe: RecipeSummary
}

interface HomePageProps {
  isVisible: boolean
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

function uniqueRecipesForGrid(recipes: RecipeSummary[]): Array<{ key: string; recipe: RecipeSummary }> {
  const seen = new Map<string, number>()

  return recipes.flatMap((recipe, index) => {
    if (!recipe.slug) {
      return [{ key: `recipe-${index}`, recipe }]
    }

    const count = seen.get(recipe.slug) ?? 0
    seen.set(recipe.slug, count + 1)
    if (count > 0) {
      return []
    }

    return [{ key: recipe.slug, recipe }]
  })
}
