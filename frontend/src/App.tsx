import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'

import { BookmarkIcon as BookmarkIconOutline } from '@heroicons/react/24/outline'
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid'

import { useAuth } from './AuthContext'
import { HomePage } from './HomePage'
import { LoginPage } from './LoginPage'
import { RecipeEditPage } from './RecipeEditPage'
import { RecipeListProvider, useRecipeListState } from './RecipeListContext'
import { RecipePage } from './RecipePage'
import { RecipeSyncProvider } from './RecipeSyncContext'
import { Popover } from './components/Popover'

export function App() {
  return (
    <RecipeSyncProvider>
      <RecipeListProvider>
        <AppShell />
      </RecipeListProvider>
    </RecipeSyncProvider>
  )
}

function AppShell() {
  const { auth, logoutPending, signOut } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const location = useLocation()
  const isHome = location.pathname === '/'

  return (
    <div className="flex min-h-dvh flex-col bg-orange-50 text-stone-900">
      <header className="sticky top-0 z-50 shrink-0 border-b border-orange-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-2 sm:py-3">
          <div className="flex items-center justify-between gap-3">
            <Link aria-label="G&E Recipes home" className="inline-flex shrink-0 items-center" to="/">
              <img alt="G&E Recipes" className="h-8 w-auto sm:h-10" src="/logo.png" />
            </Link>
            <nav className="flex shrink-0 items-center gap-2 text-sm font-medium">
              <Popover
                open={settingsOpen}
                trigger={
                  <button
                    aria-expanded={settingsOpen}
                    aria-haspopup="menu"
                    aria-label="Settings"
                    className="rounded-full px-3 py-1.5 text-stone-700 hover:bg-orange-100"
                    onClick={() => setSettingsOpen(open => !open)}
                    type="button"
                  >
                    Settings
                  </button>
                }
              >
                {auth.authenticated ? (
                  <button
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"
                    disabled={logoutPending}
                    onClick={handleSignOut}
                    type="button"
                  >
                    {logoutPending ? 'Signing out...' : 'Sign out'}
                  </button>
                ) : (
                  <Link
                    className="block rounded-xl px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-orange-50"
                    onClick={() => setSettingsOpen(false)}
                    to="/login"
                  >
                    Sign in
                  </Link>
                )}
              </Popover>
            </nav>
          </div>

          {isHome ? <HomeSearchBar /> : null}
        </div>
      </header>

      <main
        className={`mx-auto w-full max-w-6xl px-4 pb-0 ${isHome ? 'flex min-h-0 flex-1 flex-col pt-2' : 'pt-4'}`}
      >
        <Routes>
          <Route element={<HomePage />} path="/" />
          <Route element={<LoginPage />} path="/login" />
          <Route element={<RecipeEditPage mode="new" />} path="/recipes/new" />
          <Route element={<RecipeEditPage mode="edit" />} path="/recipes/edit/*" />
          <Route element={<RecipePage />} path="/recipes/*" />
        </Routes>
      </main>
    </div>
  )

  async function handleSignOut() {
    setSettingsOpen(false)
    await signOut()
  }
}

function HomeSearchBar() {
  const { bookmarkedOnly, query, setBookmarkedOnly, setQuery } = useRecipeListState()

  return (
    <div className="mt-2 flex items-center gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Search recipes</span>
        <input
          className="w-full rounded-lg border border-orange-200 bg-orange-50/80 px-3 py-1.5 text-sm outline-none ring-orange-500 placeholder:text-stone-500 focus:ring-2"
          onChange={handleQueryChange}
          onFocus={event => event.target.select()}
          placeholder="Search recipes"
          type="search"
          value={query}
        />
      </label>
      <button
        aria-label={bookmarkedOnly ? 'Show all recipes' : 'Show bookmarked recipes'}
        className="inline-flex shrink-0 items-center justify-center self-center rounded-lg p-1.5 text-orange-600 transition hover:bg-orange-50 hover:text-orange-700"
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
  )

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value)
  }
}
