import {
  BookmarkIcon as BookmarkIconOutline,
  ClipboardDocumentCheckIcon,
  TagIcon,
  UserCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  BookmarkIcon as BookmarkIconSolid,
  ClipboardDocumentCheckIcon as ClipboardDocumentCheckIconSolid,
} from '@heroicons/react/24/solid'
import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'

import { useAuth } from './AuthContext'
import { getLocalTags } from './db'
import { HomePage } from './HomePage'
import { ImportPage } from './ImportPage'
import { ImportProgressProvider } from './ImportProgressContext'
import { IngredientsPage } from './IngredientsPage'
import { LoginPage } from './LoginPage'
import { RecipeEditPage } from './RecipeEditPage'
import { RecipeDetailHeaderNav, RecipeDetailHeaderProvider } from './RecipeDetailHeaderContext'
import { RecipeListProvider, useRecipeListState } from './RecipeListContext'
import { RecipePage } from './RecipePage'
import { RecipeSyncProvider, useRecipeSync } from './RecipeSyncContext'
import { SettingsPage } from './SettingsPage'
import { Popover } from './components/Popover'
import { UnitSystemToggle } from './components/UnitSystemToggle'

export function App() {
  return (
    <RecipeSyncProvider>
      <RecipeListProvider>
        <RecipeDetailHeaderProvider>
          <ImportProgressProvider>
            <AppShell />
          </ImportProgressProvider>
        </RecipeDetailHeaderProvider>
      </RecipeListProvider>
    </RecipeSyncProvider>
  )
}

function AppShell() {
  const { auth, logoutPending, signOut } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const location = useLocation()
  const isHome = location.pathname === '/'
  const isIngredients = location.pathname === '/ingredients'
  const isRecipeDetailPage =
    location.pathname.startsWith('/recipes/') &&
    !location.pathname.startsWith('/recipes/edit') &&
    location.pathname !== '/recipes/new'

  return (
    <div
      className={`flex flex-col bg-orange-50 text-stone-900 dark:bg-stone-900 dark:text-stone-100 ${isIngredients ? 'h-dvh overflow-hidden' : 'min-h-dvh'}`}
    >
      <header className="sticky top-0 z-50 shrink-0 border-b border-orange-200 bg-white/95 backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
        <div className="mx-auto max-w-6xl px-4 py-2 sm:py-3">
          <div className="flex items-center justify-between gap-3">
            {isRecipeDetailPage ? (
              <RecipeDetailHeaderNav />
            ) : (
              <Link
                aria-label="G&E Recipes home"
                className="inline-flex shrink-0 items-center"
                to="/"
              >
                <img alt="G&E Recipes" className="h-8 w-auto sm:h-10" src="/logo.png" />
              </Link>
            )}
            <nav className="flex shrink-0 items-center gap-2 text-sm font-medium">
              {!isHome && !isRecipeDetailPage ? <UnitSystemToggle /> : null}
              <Popover
                onClose={() => setSettingsOpen(false)}
                open={settingsOpen}
                trigger={
                  <button
                    aria-expanded={settingsOpen}
                    aria-haspopup="menu"
                    aria-label="Account"
                    className="inline-flex items-center justify-center rounded-full p-1.5 text-stone-700 hover:bg-orange-100 dark:text-stone-200 dark:hover:bg-stone-700"
                    onClick={() => setSettingsOpen(open => !open)}
                    type="button"
                  >
                    <UserCircleIcon aria-hidden="true" className="h-7 w-7" />
                  </button>
                }
              >
                {auth.authenticated ? (
                  <>
                    <Link
                      className="block rounded-xl px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      onClick={() => setSettingsOpen(false)}
                      to="/settings"
                    >
                      Settings
                    </Link>
                    <Link
                      className="block rounded-xl px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      onClick={() => setSettingsOpen(false)}
                      to="/ingredients"
                    >
                      Ingredients
                    </Link>
                    <button
                      className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                      disabled={logoutPending}
                      onClick={handleSignOut}
                      type="button"
                    >
                      {logoutPending ? 'Signing out...' : 'Sign out'}
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      className="block rounded-xl px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      onClick={() => setSettingsOpen(false)}
                      to="/settings"
                    >
                      Settings
                    </Link>
                    <Link
                      className="block rounded-xl px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      onClick={() => setSettingsOpen(false)}
                      to="/login"
                    >
                      Sign in
                    </Link>
                  </>
                )}
              </Popover>
            </nav>
          </div>

          {isHome ? <HomeSearchBar /> : null}
        </div>
      </header>

      <main
        className={`mx-auto w-full max-w-6xl px-4 ${isHome ? 'pb-24 pt-2' : isIngredients ? 'flex min-h-0 flex-1 flex-col overflow-hidden pb-6 pt-4' : 'pb-8 pt-4'}`}
      >
        <div aria-hidden={!isHome} className={isHome ? undefined : 'hidden'}>
          <HomePage isVisible={isHome} />
        </div>
        {!isHome ? (
          <Routes>
            <Route element={<LoginPage />} path="/login" />
            <Route element={<SettingsPage />} path="/settings" />
            <Route element={<IngredientsPage />} path="/ingredients" />
            <Route element={<ImportPage />} path="/import" />
            <Route element={<RecipeEditPage mode="new" />} path="/recipes/new" />
            <Route element={<RecipeEditPage mode="edit" />} path="/recipes/edit/*" />
            <Route element={<RecipePage />} path="/recipes/*" />
          </Routes>
        ) : null}
      </main>
    </div>
  )

  async function handleSignOut() {
    setSettingsOpen(false)
    await signOut()
  }
}

function HomeSearchBar() {
  const {
    activeTags,
    bookmarkedOnly,
    query,
    reviewOnly,
    setActiveTags,
    setBookmarkedOnly,
    setQuery,
    setReviewOnly,
  } = useRecipeListState()
  const { localRevision } = useRecipeSync()
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [inputValue, setInputValue] = useState(query)
  const [tagsOpen, setTagsOpen] = useState(false)
  const selectedTags = useMemo(() => new Set(activeTags), [activeTags])
  const unselectedTags = useMemo(
    () => availableTags.filter(tag => !selectedTags.has(tag)),
    [availableTags, selectedTags]
  )

  useEffect(() => {
    if (inputValue === query) {
      return
    }
    const timer = window.setTimeout(() => setQuery(inputValue), 200)
    return () => window.clearTimeout(timer)
  }, [inputValue, query, setQuery])

  useEffect(() => {
    let cancelled = false
    getLocalTags().then(tags => {
      if (!cancelled) {
        setAvailableTags(tags)
      }
    })
    return () => {
      cancelled = true
    }
  }, [localRevision])

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search recipes</span>
          <input
            autoFocus
            className="w-full rounded-lg border border-orange-200 bg-orange-50/80 px-3 py-1.5 text-sm outline-none ring-orange-500 placeholder:text-stone-500 focus:ring-2 dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-100 dark:placeholder:text-stone-400"
            onChange={handleQueryChange}
            onFocus={event => event.target.select()}
            placeholder="Search recipes"
            type="search"
            value={inputValue}
          />
        </label>
        <Popover
          align="right"
          onClose={() => setTagsOpen(false)}
          open={tagsOpen}
          trigger={
            <button
              aria-expanded={tagsOpen}
              aria-haspopup="listbox"
              aria-label="Filter by tags"
              className={`inline-flex shrink-0 items-center justify-center self-center rounded-lg p-1.5 transition hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-stone-700 dark:hover:text-orange-300 ${
                activeTags.length ? 'text-orange-700' : 'text-orange-600'
              }`}
              onClick={() => setTagsOpen(open => !open)}
              type="button"
            >
              <TagIcon aria-hidden="true" className="h-5 w-5" />
            </button>
          }
        >
          {unselectedTags.length ? (
            <div className="max-h-56 overflow-y-auto" role="listbox">
              {unselectedTags.map(tag => (
                <button
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                  key={tag}
                  onClick={() => addTag(tag)}
                  role="option"
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-2 text-sm text-stone-500 dark:text-stone-400">
              No tags available
            </p>
          )}
        </Popover>
        <button
          aria-label={reviewOnly ? 'Show all recipes' : 'Show recipes needing review'}
          className="inline-flex shrink-0 items-center justify-center self-center rounded-lg p-1.5 text-orange-600 transition hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-stone-700 dark:hover:text-orange-300"
          onClick={() => setReviewOnly(!reviewOnly)}
          type="button"
        >
          {reviewOnly ? (
            <ClipboardDocumentCheckIconSolid aria-hidden="true" className="h-5 w-5" />
          ) : (
            <ClipboardDocumentCheckIcon aria-hidden="true" className="h-5 w-5" />
          )}
        </button>
        <button
          aria-label={bookmarkedOnly ? 'Show all recipes' : 'Show bookmarked recipes'}
          className="inline-flex shrink-0 items-center justify-center self-center rounded-lg p-1.5 text-orange-600 transition hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-stone-700 dark:hover:text-orange-300"
          onClick={() => setBookmarkedOnly(!bookmarkedOnly)}
          type="button"
        >
          {bookmarkedOnly ? (
            <BookmarkIconSolid aria-hidden="true" className="h-5 w-5" />
          ) : (
            <BookmarkIconOutline aria-hidden="true" className="h-5 w-5" />
          )}
        </button>
      </div>
      {activeTags.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {activeTags.map(tag => (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-orange-100 py-0.5 pl-2.5 pr-1 text-sm text-orange-800 dark:bg-orange-950/60 dark:text-orange-200"
              key={tag}
            >
              {tag}
              <button
                aria-label={`Remove ${tag} tag filter`}
                className="inline-flex rounded-full p-0.5 hover:bg-orange-200 dark:hover:bg-orange-900/60"
                onClick={() => removeTag(tag)}
                type="button"
              >
                <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )

  function addTag(tag: string) {
    setActiveTags(
      [...activeTags, tag].sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: 'base' })
      )
    )
    setTagsOpen(false)
  }

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setInputValue(event.target.value)
  }

  function removeTag(tag: string) {
    setActiveTags(activeTags.filter(item => item !== tag))
  }
}
