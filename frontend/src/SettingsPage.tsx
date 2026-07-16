import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from './AuthContext'
import { BulkImportControls } from './components/BulkImportControls'
import { Button } from './components/Button'
import { ThemePicker } from './components/ThemePicker'
import { UnitSystemToggle } from './components/UnitSystemToggle'
import { buildLoginUrl } from './shareImport'
import { cardClassName } from './themeClasses'

export function SettingsPage() {
  const { auth } = useAuth()
  const navigate = useNavigate()

  function requireEditor(run: () => void) {
    if (!auth.authenticated) {
      navigate(buildLoginUrl('/settings'))
      return
    }
    run()
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
      </div>
    </section>
  )
}
