import {
  ArrowRightOnRectangleIcon,
  BeakerIcon,
  BookmarkIcon as BookmarkIconOutline,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  GlobeAltIcon,
  TagIcon,
  UserCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid'
import type { ChangeEvent } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'

import { useAuth } from './AuthContext'
import { getLocalSitesByCount, getLocalSummaries, getLocalTags, type LocalSiteCount } from './db'
import { formatSiteLabel } from './site'
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
import { ReviewPage } from './ReviewPage'
import { SettingsPage } from './SettingsPage'
import { IconButton } from './components/IconButton'
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
  const { auth } = useAuth()
  const { localRevision } = useRecipeSync()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [needsReviewCount, setNeedsReviewCount] = useState(0)
  const location = useLocation()
  const isHome = location.pathname === '/'
  const isIngredients = location.pathname === '/ingredients'
  const isRecipeDetailPage =
    location.pathname.startsWith('/recipes/') &&
    !location.pathname.startsWith('/recipes/edit') &&
    location.pathname !== '/recipes/new'

  useEffect(() => {
    if (!auth.authenticated) {
      setNeedsReviewCount(0)
      return
    }
    let cancelled = false
    getLocalSummaries().then(summaries => {
      if (cancelled) {
        return
      }
      setNeedsReviewCount(
        summaries.filter(recipe => recipe.review && recipe.review.length > 0).length
      )
    })
    return () => {
      cancelled = true
    }
  }, [auth.authenticated, localRevision])

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
                  <IconButton
                    aria-expanded={settingsOpen}
                    aria-haspopup="menu"
                    aria-label="Account"
                    className="h-10 w-10"
                    icon={<UserCircleIcon aria-hidden="true" className="h-7 w-7" />}
                    onClick={() => setSettingsOpen(open => !open)}
                  />
                }
              >
                {auth.authenticated ? (
                  <>
                    <Link
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      onClick={() => setSettingsOpen(false)}
                      to="/ingredients"
                    >
                      <BeakerIcon
                        aria-hidden="true"
                        className="h-5 w-5 text-orange-600 dark:text-orange-400"
                      />
                      Ingredients
                    </Link>
                    {needsReviewCount > 0 ? (
                      <Link
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                        onClick={() => setSettingsOpen(false)}
                        to="/review"
                      >
                        <ClipboardDocumentListIcon
                          aria-hidden="true"
                          className="h-5 w-5 text-orange-600 dark:text-orange-400"
                        />
                        Needs review ({needsReviewCount})
                      </Link>
                    ) : null}
                    <Link
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      onClick={() => setSettingsOpen(false)}
                      to="/settings"
                    >
                      <Cog6ToothIcon
                        aria-hidden="true"
                        className="h-5 w-5 text-orange-600 dark:text-orange-400"
                      />
                      Settings
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      onClick={() => setSettingsOpen(false)}
                      to="/login"
                    >
                      <ArrowRightOnRectangleIcon
                        aria-hidden="true"
                        className="h-5 w-5 text-orange-600 dark:text-orange-400"
                      />
                      Sign in
                    </Link>
                    <Link
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      onClick={() => setSettingsOpen(false)}
                      to="/settings"
                    >
                      <Cog6ToothIcon
                        aria-hidden="true"
                        className="h-5 w-5 text-orange-600 dark:text-orange-400"
                      />
                      Settings
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
            <Route element={<ReviewPage />} path="/review" />
            <Route element={<ImportPage />} path="/import" />
            <Route element={<RecipeEditPage mode="new" />} path="/recipes/new" />
            <Route element={<RecipeEditPage mode="edit" />} path="/recipes/edit/*" />
            <Route element={<RecipePage />} path="/recipes/*" />
          </Routes>
        ) : null}
      </main>
    </div>
  )
}

function HomeSearchBar() {
  const {
    activeSites,
    activeTags,
    bookmarkedOnly,
    query,
    setActiveSites,
    setActiveTags,
    setBookmarkedOnly,
    setQuery,
  } = useRecipeListState()
  const { localRevision } = useRecipeSync()
  const inputRef = useRef<HTMLInputElement>(null)
  const [availableSites, setAvailableSites] = useState<LocalSiteCount[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [inputValue, setInputValue] = useState(query)
  const [sitesOpen, setSitesOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const selectedSites = useMemo(() => new Set(activeSites), [activeSites])
  const selectedTags = useMemo(() => new Set(activeTags), [activeTags])
  const unselectedSites = useMemo(
    () => availableSites.filter(entry => !selectedSites.has(entry.site)),
    [availableSites, selectedSites]
  )
  const unselectedTags = useMemo(
    () => availableTags.filter(tag => !selectedTags.has(tag)),
    [availableTags, selectedTags]
  )

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    // preventScroll so remounting the search bar does not jump the recipe list to the top.
    input.focus({ preventScroll: true })
    input.select()
  }, [])

  useEffect(() => {
    if (inputValue === query) {
      return
    }
    const timer = window.setTimeout(() => setQuery(inputValue), 200)
    return () => window.clearTimeout(timer)
  }, [inputValue, query, setQuery])

  useEffect(() => {
    let cancelled = false
    Promise.all([getLocalTags(), getLocalSitesByCount()]).then(([tags, sites]) => {
      if (!cancelled) {
        setAvailableTags(tags)
        setAvailableSites(sites)
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
            className="w-full rounded-lg border border-orange-200 bg-orange-50/80 px-3 py-1.5 text-sm outline-none ring-orange-500 placeholder:text-stone-500 focus:ring-2 dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-100 dark:placeholder:text-stone-400"
            onChange={handleQueryChange}
            onFocus={event => event.target.select()}
            placeholder="Search recipes"
            ref={inputRef}
            type="search"
            value={inputValue}
          />
        </label>
        <Popover
          align="right"
          onClose={() => setSitesOpen(false)}
          open={sitesOpen}
          trigger={
            <IconButton
              aria-expanded={sitesOpen}
              aria-haspopup="listbox"
              aria-label="Filter by source"
              className={activeSites.length ? 'text-orange-700' : 'text-orange-600'}
              icon={<GlobeAltIcon aria-hidden="true" className="h-5 w-5" />}
              onClick={() => setSitesOpen(open => !open)}
              tooltip={{ content: 'Filter by source' }}
            />
          }
        >
          {unselectedSites.length ? (
            <div className="max-h-56 min-w-44 overflow-y-auto" role="listbox">
              {unselectedSites.map(entry => (
                <button
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                  key={entry.site}
                  onClick={() => addSite(entry.site)}
                  role="option"
                  type="button"
                >
                  <span>{formatSiteLabel(entry.site)}</span>
                  <span className="tabular-nums text-stone-500 dark:text-stone-400">
                    {entry.count}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-2 text-sm text-stone-500 dark:text-stone-400">
              No sources available
            </p>
          )}
        </Popover>
        <Popover
          align="right"
          onClose={() => setTagsOpen(false)}
          open={tagsOpen}
          trigger={
            <IconButton
              aria-expanded={tagsOpen}
              aria-haspopup="listbox"
              aria-label="Filter by tags"
              className={activeTags.length ? 'text-orange-700' : 'text-orange-600'}
              icon={<TagIcon aria-hidden="true" className="h-5 w-5" />}
              onClick={() => setTagsOpen(open => !open)}
              tooltip={{ content: 'Filter by tags' }}
            />
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
        <IconButton
          aria-label={bookmarkedOnly ? 'Show all recipes' : 'Show bookmarked recipes'}
          className="text-orange-600"
          icon={
            bookmarkedOnly ? (
              <BookmarkIconSolid aria-hidden="true" className="h-5 w-5" />
            ) : (
              <BookmarkIconOutline aria-hidden="true" className="h-5 w-5" />
            )
          }
          onClick={() => setBookmarkedOnly(!bookmarkedOnly)}
          tooltip={{
            content: bookmarkedOnly ? 'Show all recipes' : 'Show bookmarked recipes',
          }}
        />
      </div>
      {activeSites.length || activeTags.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {activeSites.map(site => (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-sky-100 py-0.5 pl-2.5 pr-1 text-sm text-sky-900 dark:bg-sky-950/60 dark:text-sky-200"
              key={`site-${site}`}
            >
              {formatSiteLabel(site)}
              <button
                aria-label={`Remove ${formatSiteLabel(site)} source filter`}
                className="inline-flex rounded-full p-0.5 hover:bg-sky-200 dark:hover:bg-sky-900/60"
                onClick={() => removeSite(site)}
                type="button"
              >
                <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {activeTags.map(tag => (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-orange-100 py-0.5 pl-2.5 pr-1 text-sm text-orange-800 dark:bg-orange-950/60 dark:text-orange-200"
              key={`tag-${tag}`}
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

  function addSite(site: string) {
    setActiveSites(
      [...activeSites, site].sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: 'base' })
      )
    )
    setSitesOpen(false)
  }

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

  function removeSite(site: string) {
    setActiveSites(activeSites.filter(item => item !== site))
  }

  function removeTag(tag: string) {
    setActiveTags(activeTags.filter(item => item !== tag))
  }
}
