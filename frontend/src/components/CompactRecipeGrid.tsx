import type { ReactNode } from 'react'
import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../AuthContext'
import type { RecipeSummary } from '../types'
import { BookmarkButton } from './BookmarkButton'

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

export function CompactRecipeGrid({
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
            <h2 className="text-sm font-bold uppercase tracking-wide text-stone-700 dark:text-stone-300">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {headerAction}
        </div>
      ) : null}
      <div className={`grid grid-cols-3 gap-3 ${title || headerAction ? 'mt-2' : ''}`}>
        {tiles.map(({ key, recipe }) => (
          <CompactRecipeTile
            bookmarkPending={bookmarkPendingSlug === recipe.slug}
            key={key}
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
      <p className="mt-1 line-clamp-2 text-sm font-semibold leading-tight text-stone-900 dark:text-stone-100">
        {recipe.title}
      </p>
    </Link>
  )
})

function uniqueRecipesForGrid(
  recipes: RecipeSummary[]
): Array<{ key: string; recipe: RecipeSummary }> {
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
