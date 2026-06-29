import { useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'

import { useAuth } from './AuthContext'
import { HomePage } from './HomePage'
import { LoginPage } from './LoginPage'
import { RecipeEditPage } from './RecipeEditPage'
import { RecipeListProvider } from './RecipeListContext'
import { RecipePage } from './RecipePage'
import { Popover } from './components/Popover'

export function App() {
  const { auth, logoutPending, signOut } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <RecipeListProvider>
      <div className="min-h-screen bg-orange-50 text-stone-900">
      <header className="border-b border-orange-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-4">
          <Link aria-label="G&E Recipes home" className="inline-flex items-center" to="/">
            <img alt="G&E Recipes" className="h-8 w-auto sm:h-12" src="/logo.png" />
          </Link>
          <nav className="flex items-center gap-3 text-sm font-medium">
            <Popover
              open={settingsOpen}
              trigger={
                <button
                  aria-expanded={settingsOpen}
                  aria-haspopup="menu"
                  aria-label="Settings"
                  className="rounded-full px-3 py-1.5 text-stone-700 hover:bg-orange-100 sm:py-2"
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
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-0 pt-4">
        <Routes>
          <Route element={<HomePage />} path="/" />
          <Route element={<LoginPage />} path="/login" />
          <Route element={<RecipeEditPage mode="new" />} path="/recipes/new" />
          <Route element={<RecipeEditPage mode="edit" />} path="/recipes/edit/*" />
          <Route element={<RecipePage />} path="/recipes/*" />
        </Routes>
      </main>
      </div>
    </RecipeListProvider>
  )

  async function handleSignOut() {
    setSettingsOpen(false)
    await signOut()
  }
}
