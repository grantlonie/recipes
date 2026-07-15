import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

import type { RecipeSummary } from './types'

const RECENT_RECIPES_KEY = 'recipes.recentlyViewed'
const RECENT_RECIPES_LIMIT = 18

interface RecipeListState {
  activeTags: string[]
  bookmarkedOnly: boolean
  query: string
  recentRecipes: RecipeSummary[]
  reviewOnly: boolean
  scrollTop: number
  addRecentRecipe: (recipe: RecipeSummary) => void
  removeRecentRecipe: (slug: string) => void
  setActiveTags: (tags: string[]) => void
  setBookmarkedOnly: (value: boolean) => void
  setQuery: (value: string) => void
  setReviewOnly: (value: boolean) => void
  setScrollTop: (value: number) => void
}

const RecipeListContext = createContext<RecipeListState | null>(null)

interface RecipeListProviderProps {
  children: ReactNode
}

export function RecipeListProvider({ children }: RecipeListProviderProps) {
  const [activeTags, setActiveTagsState] = useState<string[]>([])
  const [bookmarkedOnly, setBookmarkedOnlyState] = useState(false)
  const [reviewOnly, setReviewOnlyState] = useState(false)
  const [query, setQueryState] = useState('')
  const [recentRecipes, setRecentRecipes] = useState<RecipeSummary[]>(() => readRecentRecipes())
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    window.localStorage.setItem(
      RECENT_RECIPES_KEY,
      JSON.stringify(recentRecipes.slice(0, RECENT_RECIPES_LIMIT))
    )
  }, [recentRecipes])

  const addRecentRecipe = useCallback((recipe: RecipeSummary) => {
    setRecentRecipes(current =>
      [recipe, ...current.filter(item => item.slug !== recipe.slug)].slice(0, RECENT_RECIPES_LIMIT)
    )
  }, [])

  const removeRecentRecipe = useCallback((slug: string) => {
    setRecentRecipes(current => current.filter(item => item.slug !== slug))
  }, [])

  const setActiveTags = useCallback((tags: string[]) => {
    setActiveTagsState(tags)
    setScrollTop(0)
  }, [])

  const setBookmarkedOnly = useCallback((value: boolean) => {
    setBookmarkedOnlyState(value)
    if (value) {
      setReviewOnlyState(false)
    }
    setScrollTop(0)
  }, [])

  const setReviewOnly = useCallback((value: boolean) => {
    setReviewOnlyState(value)
    if (value) {
      setBookmarkedOnlyState(false)
    }
    setScrollTop(0)
  }, [])

  const setQuery = useCallback((value: string) => {
    setQueryState(value)
    setScrollTop(0)
  }, [])

  return (
    <RecipeListContext.Provider
      value={{
        activeTags,
        addRecentRecipe,
        bookmarkedOnly,
        removeRecentRecipe,
        query,
        recentRecipes,
        reviewOnly,
        scrollTop,
        setActiveTags,
        setBookmarkedOnly,
        setQuery,
        setReviewOnly,
        setScrollTop,
      }}
    >
      {children}
    </RecipeListContext.Provider>
  )
}

export function useRecipeListState() {
  const value = useContext(RecipeListContext)
  if (!value) {
    throw new Error('useRecipeListState must be used within RecipeListProvider')
  }
  return value
}

function readRecentRecipes() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_RECIPES_KEY) ?? '[]')
    if (!Array.isArray(parsed)) {
      return []
    }

    const seen = new Set<string>()
    const recipes: RecipeSummary[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || typeof item.slug !== 'string' || !item.slug.trim()) {
        continue
      }
      if (seen.has(item.slug)) {
        continue
      }
      seen.add(item.slug)
      recipes.push(item as RecipeSummary)
      if (recipes.length >= RECENT_RECIPES_LIMIT) {
        break
      }
    }
    return recipes
  } catch {
    return []
  }
}
