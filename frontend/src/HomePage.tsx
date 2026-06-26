import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { ChangeEvent, UIEvent } from 'react'
import { useEffect, useMemo, useRef } from 'react'

import { getRecipes, getTags, updateRecipeMetadata } from './api'
import { useAuth } from './AuthContext'
import { BookmarkButton } from './components/BookmarkButton'
import { TagMultiSelect } from './components/TagMultiSelect'
import { useRecipeListState } from './RecipeListContext'
import type { RecipeSummary } from './types'

export function HomePage() {
  const { auth } = useAuth()
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
  const queryClient = useQueryClient()
  const recipesScrollRef = useRef<HTMLDivElement | null>(null)
  const recipesQuery = useQuery({
    queryFn: () => getRecipes(query),
    queryKey: ['recipes', query],
  })
  const tagsQuery = useQuery({ queryFn: getTags, queryKey: ['tags'] })
  const recipes = useMemo(
    () => filterRecipes(recipesQuery.data ?? [], bookmarkedOnly, activeTags),
    [activeTags, bookmarkedOnly, recipesQuery.data]
  )
  const isSearching = query.trim().length > 0
  const bookmarkMutation = useMutation({
    mutationFn: (recipe: RecipeSummary) =>
      updateRecipeMetadata(recipe.slug, { bookmarked: !recipe.bookmarked }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    },
  })

  useEffect(() => {
    if (recipesScrollRef.current) {
      recipesScrollRef.current.scrollTop = scrollTop
    }
  }, [recipes.length, scrollTop])

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
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
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl shadow-sm ring-1 ring-orange-200 transition hover:bg-orange-100 ${
              bookmarkedOnly ? 'bg-orange-600 text-white' : 'bg-white text-stone-700'
            }`}
            onClick={() => setBookmarkedOnly(!bookmarkedOnly)}
            type="button"
          >
            <span aria-hidden="true">{bookmarkedOnly ? '★' : '☆'}</span>
          </button>
          <div className="min-w-0 flex-1">
            <TagMultiSelect
              availableTags={tagsQuery.data ?? []}
              onChange={setActiveTags}
              placeholder="Filter by tags"
              value={activeTags}
            />
          </div>
        </div>
      </section>

      {!isSearching ? <RecentRecipes recipes={recentRecipes} /> : null}

      <section
        className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 pt-5"
        onScroll={handleRecipesScroll}
        ref={recipesScrollRef}
      >
        {recipesQuery.isLoading ? (
          <p className="rounded-2xl bg-white p-6 text-stone-600">Loading recipes...</p>
        ) : recipes.length ? (
          isSearching ? (
            <CompactRecipeGrid recipes={recipes} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {recipes.map(recipe => (
                <RecipeCard
                  canBookmark={auth.authenticated}
                  key={recipe.slug}
                  onToggleBookmark={handleToggleBookmark}
                  pendingBookmark={bookmarkMutation.isPending}
                  recipe={recipe}
                />
              ))}
            </div>
          )
        ) : (
          <p className="rounded-2xl bg-white p-6 text-stone-600">No recipes found.</p>
        )}
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

  async function handleToggleBookmark(recipe: RecipeSummary) {
    await bookmarkMutation.mutateAsync(recipe)
  }
}

function RecentRecipes({ recipes }: RecentRecipesProps) {
  if (!recipes.length) {
    return null
  }

  return (
    <CompactRecipeGrid recipes={recipes} title="Recently Viewed" />
  )
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

function RecipeCard({ canBookmark, onToggleBookmark, pendingBookmark, recipe }: RecipeCardProps) {
  return (
    <article className="group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-orange-100 transition hover:-translate-y-0.5 hover:shadow-md">
      {canBookmark ? (
        <BookmarkButton
          bookmarked={recipe.bookmarked}
          className="absolute right-3 top-3 z-10"
          disabled={pendingBookmark}
          onToggle={() => onToggleBookmark(recipe)}
        />
      ) : null}
      <Link className="block" to={`/recipes/${recipe.slug}`}>
        {recipe.image ? (
          <div className="aspect-video w-full overflow-hidden">
            <img
              alt=""
              className="block h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              src={recipe.image}
            />
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-orange-100">
            <img
              alt=""
              className="h-28 w-28 object-contain opacity-90"
              src="/web-app-icon-512.png"
            />
          </div>
        )}
        <div className="space-y-3 p-4">
          <h2 className="text-xl font-semibold group-hover:text-orange-700">{recipe.title}</h2>
          <div className="flex flex-wrap gap-2">
            {recipe.tags.slice(0, 4).map(tag => (
              <span
                className="rounded-full bg-orange-100 px-2.5 py-1 text-xs text-orange-800"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-stone-600">
            {recipe.servings} servings{recipe.cook_time ? ` · ${recipe.cook_time}` : ''}
          </p>
        </div>
      </Link>
    </article>
  )
}

interface RecentRecipesProps {
  recipes: RecipeSummary[]
}

interface CompactRecipeGridProps {
  recipes: RecipeSummary[]
  title?: string
}

interface CompactRecipeTileProps {
  recipe: RecipeSummary
}

interface RecipeCardProps {
  canBookmark: boolean
  onToggleBookmark: (recipe: RecipeSummary) => Promise<void>
  pendingBookmark: boolean
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
