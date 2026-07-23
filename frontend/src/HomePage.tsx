import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { updateRecipeMetadata } from './api'
import { Button } from './components/Button'
import { CompactRecipeGrid } from './components/CompactRecipeGrid'
import { NewRecipeFab } from './components/NewRecipeFab'
import { getAllStoredRecipes, getLocalSummaries } from './db'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { searchRecipes } from './search'
import { storeRecipe } from './sync'
import type { RecipeDetail, RecipeSummary } from './types'

interface HomePageProps {
  isVisible: boolean
}

interface BookmarkInput {
  bookmarked: boolean
  slug: string
}

export function HomePage({ isVisible }: HomePageProps) {
  const { localRevision, notifyLocalChange, status, sync } = useRecipeSync()
  const {
    activeTags,
    bookmarkedOnly,
    pruneRecentRecipes,
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
      notifyLocalChange()
      setSummaries(current =>
        current.map(summary => (summary.slug === recipe.slug ? summaryFromDetail(recipe) : summary))
      )
      setDetails(current => current.map(detail => (detail.slug === recipe.slug ? recipe : detail)))
    },
  })
  const handleBookmarkToggle = useCallback(
    (recipe: RecipeSummary) => {
      bookmarkMutation.mutate({ bookmarked: recipe.bookmarked, slug: recipe.slug })
    },
    [bookmarkMutation]
  )
  const searchQuery = query.trim()
  const showSearchResults = searchQuery.length > 0
  const bookmarkedRecipes = useMemo(
    () => filterRecipes(summaries, { bookmarkedOnly: true, activeTags }),
    [activeTags, summaries]
  )
  const displayRecentRecipes = useMemo(() => {
    if (!localReady) {
      return []
    }
    const bySlug = new Map(summaries.map(summary => [summary.slug, summary]))
    return recentRecipes
      .map(recipe => bySlug.get(recipe.slug))
      .filter((recipe): recipe is RecipeSummary => recipe != null)
  }, [localReady, recentRecipes, summaries])
  const taggedRecipes = useMemo(
    () => filterRecipes(summaries, { activeTags }),
    [activeTags, summaries]
  )
  const hasTagFilter = activeTags.length > 0
  const recipes = useMemo(() => {
    if (!showSearchResults) {
      return []
    }
    return filterRecipes(searchRecipes(summaries, details, searchQuery), {
      bookmarkedOnly,
      activeTags,
    })
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
      pruneRecentRecipes(new Set(nextSummaries.map(summary => summary.slug)))
    })
    return () => {
      cancelled = true
    }
  }, [localRevision, pruneRecentRecipes])

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
            <p className="text-sm text-stone-600 dark:text-stone-400">
              No recipes match these tags.
            </p>
          )
        ) : !localReady ? (
          <p className="text-stone-600 dark:text-stone-400">Loading recipes...</p>
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

function summaryFromDetail(recipe: RecipeDetail): RecipeSummary {
  return {
    bookmarked: recipe.bookmarked,
    cook_time: recipe.cook_time,
    image: recipe.image,
    notes: recipe.notes,
    original_url: recipe.original_url,
    review: recipe.review,
    servings: recipe.servings,
    slug: recipe.slug,
    tags: recipe.tags,
    title: recipe.title,
  }
}

function filterRecipes(
  recipes: RecipeSummary[],
  options: {
    activeTags?: string[]
    bookmarkedOnly?: boolean
  } = {}
) {
  const activeTags = options.activeTags ?? []
  return recipes.filter(recipe => {
    if (options.bookmarkedOnly && !recipe.bookmarked) {
      return false
    }
    if (activeTags.some(tag => !recipe.tags.includes(tag))) {
      return false
    }
    return true
  })
}
