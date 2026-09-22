import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from './AuthContext'
import { BulkImportControls } from './components/BulkImportControls'
import { Button } from './components/Button'
import { ThemePicker } from './components/ThemePicker'
import { UnitSystemToggle } from './components/UnitSystemToggle'
import { buildLoginUrl } from './shareImport'
import { cardClassName } from './themeClasses'
import { isMassUnitSystem } from './units'
import { useUnitSystem } from './UnitSystemContext'

export function SettingsPage() {
  const { auth, logoutPending, signOut } = useAuth()
  const { preferSmallSpoons, setPreferSmallSpoons, unitSystem } = useUnitSystem()
  const navigate = useNavigate()

  function requireEditor(run: () => void) {
    if (!auth.authenticated) {
      navigate(buildLoginUrl('/settings'))
      return
    }
    run()
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <section className={`mx-auto max-w-md ${cardClassName}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Settings</h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            Customize how the app looks and displays measurements.
          </p>
        </div>
        <Link
          className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-stone-700"
          to="/"
        >
          Back
        </Link>
      </div>

      <div className="mt-8 space-y-8">
        <ThemePicker />

        <div>
          <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Units</h2>
          <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
            Choose how ingredient amounts are shown in recipes.
          </p>
          <div className="mt-3">
            <UnitSystemToggle fullWidth />
          </div>
          {isMassUnitSystem(unitSystem) ? (
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-orange-200 bg-white px-4 py-3 dark:border-stone-600 dark:bg-stone-900">
              <input
                checked={preferSmallSpoons}
                className="mt-0.5 h-4 w-4 shrink-0 accent-orange-600"
                onChange={event => setPreferSmallSpoons(event.target.checked)}
                type="checkbox"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">
                  Show 1 Tbsp and under as tbsp/tsp
                </span>
                <span className="mt-0.5 block text-xs text-stone-600 dark:text-stone-400">
                  Small amounts stay as measuring spoons instead of grams or ounces.
                </span>
              </span>
            </label>
          ) : null}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Files</h2>
          <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
            Import one or more recipes from files, a folder, or a zip. Matching source URLs are
            skipped so existing recipes are not remapped.
          </p>
          <BulkImportControls>
            {({ openFiles }) => (
              <div className="mt-3">
                <Button onClick={() => requireEditor(openFiles)} type="button" variant="secondary">
                  Import files
                </Button>
              </div>
            )}
          </BulkImportControls>
        </div>

        {auth.authenticated ? (
          <div>
            <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Account</h2>
            <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
              Signed in{auth.username ? ` as ${auth.username}` : ''}.
            </p>
            <div className="mt-3">
              <Button
                disabled={logoutPending}
                onClick={() => void handleSignOut()}
                type="button"
                variant="danger"
              >
                {logoutPending ? 'Signing out...' : 'Sign out'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
