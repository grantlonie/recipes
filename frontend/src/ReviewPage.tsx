import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { updateRecipeMetadata } from './api'
import { CompactRecipeGrid } from './components/CompactRecipeGrid'
import { getLocalSummaries } from './db'
import { useRecipeSync } from './RecipeSyncContext'
import { storeRecipe } from './sync'
import type { RecipeSummary } from './types'

interface BookmarkInput {
  bookmarked: boolean
  slug: string
}

export function ReviewPage() {
  const { localRevision, notifyLocalChange, sync } = useRecipeSync()
  const [summaries, setSummaries] = useState<RecipeSummary[]>([])
  const [localReady, setLocalReady] = useState(false)
  const bookmarkMutation = useMutation({
    mutationFn: ({ bookmarked, slug }: BookmarkInput) =>
      updateRecipeMetadata(slug, { bookmarked: !bookmarked }),
    onSuccess: async recipe => {
      await storeRecipe(recipe)
      notifyLocalChange()
      setSummaries(current =>
        current.map(summary =>
          summary.slug === recipe.slug
            ? {
                ...summary,
                bookmarked: recipe.bookmarked,
                review: recipe.review,
              }
            : summary
        )
      )
    },
  })
  const handleBookmarkToggle = useCallback(
    (recipe: RecipeSummary) => {
      bookmarkMutation.mutate({ bookmarked: recipe.bookmarked, slug: recipe.slug })
    },
    [bookmarkMutation]
  )
  const reviewRecipes = useMemo(
    () => summaries.filter(recipe => recipe.review && recipe.review.length > 0),
    [summaries]
  )

  useEffect(() => {
    sync()
  }, [sync])

  useEffect(() => {
    let cancelled = false
    getLocalSummaries().then(nextSummaries => {
      if (cancelled) {
        return
      }
      setSummaries(nextSummaries)
      setLocalReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [localRevision])

  if (!localReady) {
    return <p className="text-stone-600 dark:text-stone-400">Loading recipes...</p>
  }

  if (!reviewRecipes.length) {
    return (
      <p className="text-sm text-stone-600 dark:text-stone-400">No recipes need review.</p>
    )
  }

  return (
    <CompactRecipeGrid
      bookmarkPendingSlug={
        bookmarkMutation.isPending ? bookmarkMutation.variables?.slug : undefined
      }
      onBookmarkToggle={handleBookmarkToggle}
      recipes={reviewRecipes}
      title="Needs review"
    />
  )
}
