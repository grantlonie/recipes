import { Link, Route, Routes } from 'react-router-dom'

import { useAuth } from './AuthContext'
import { HomePage } from './HomePage'
import { LoginPage } from './LoginPage'
import { RecipeEditPage } from './RecipeEditPage'
import { RecipeListProvider } from './RecipeListContext'
import { RecipePage } from './RecipePage'

export function App() {
  const { auth, logoutPending, signOut } = useAuth()

  return (
    <RecipeListProvider>
      <div className="min-h-screen bg-orange-50 text-stone-900">
      <header className="border-b border-orange-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link aria-label="G&E Recipes home" className="inline-flex items-center" to="/">
            <img alt="G&E Recipes" className="h-12 w-auto" src="/logo.png" />
          </Link>
          <nav className="flex items-center gap-3 text-sm font-medium">
            {auth.authenticated ? (
              <>
                <button
                  className="rounded-full px-3 py-2 text-stone-700 hover:bg-orange-100"
                  disabled={logoutPending}
                  onClick={handleSignOut}
                  type="button"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                className="rounded-full bg-orange-600 px-3 py-2 text-white hover:bg-orange-700"
                to="/login"
              >
                Sign in
              </Link>
            )}
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
    await signOut()
  }
}
