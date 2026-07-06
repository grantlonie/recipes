import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { createRecipe, importRecipe } from './api'
import { useAuth } from './AuthContext'
import { Button } from './components/Button'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import {
  buildImportPath,
  buildLoginUrl,
  clearImportSession,
  ensureUniqueSlug,
  extractRecipeUrl,
  findRecipeBySourceUrl,
  formatImportError,
  getImportSession,
  markImportDone,
} from './shareImport'
import { storeRecipe } from './sync'
import type { RecipeDetail, RecipeSummary } from './types'

type ImportResult =
  | { kind: 'created'; recipe: RecipeDetail }
  | { kind: 'existing'; recipe: RecipeSummary }

export function ImportPage() {
  const { auth, authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { sync } = useRecipeSync()
  const { addRecentRecipe } = useRecipeListState()
  const importStarted = useRef(false)
  const [manualUrl, setManualUrl] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const sharedUrl = extractRecipeUrl({
    text: searchParams.get('text'),
    url: searchParams.get('url'),
  })

  useEffect(() => {
    importStarted.current = false
    setImportError(null)
  }, [sharedUrl])

  const importMutation = useMutation({
    mutationFn: async (recipeUrl: string): Promise<ImportResult> => {
      const existing = await findRecipeBySourceUrl(recipeUrl)
      if (existing) {
        return { kind: 'existing', recipe: existing }
      }

      const preview = await importRecipe(recipeUrl)
      const slug = await ensureUniqueSlug(preview.suggested_slug)
      const recipe = await createRecipe(slug, preview.content)
      await storeRecipe(recipe)
      await sync()
      return { kind: 'created', recipe }
    },
    onError: error => {
      setImportError(formatImportError(error))
    },
    onSuccess: result => {
      setImportError(null)

      if (result.kind === 'existing') {
        addRecentRecipe(result.recipe)
        window.setTimeout(() => {
          navigate(`/recipes/${result.recipe.slug}`, { replace: true })
        }, 1500)
        return
      }

      queryClient.setQueryData(['recipe', result.recipe.slug], result.recipe)
      addRecentRecipe(result.recipe)
      navigate(`/recipes/${result.recipe.slug}`, { replace: true })
    },
  })

  useEffect(() => {
    if (authLoading || auth.authenticated) {
      return
    }

    navigate(buildLoginUrl(`/import${window.location.search}`), { replace: true })
  }, [auth.authenticated, authLoading, navigate])

  useEffect(() => {
    if (authLoading || !auth.authenticated || !sharedUrl || importStarted.current) {
      return
    }

    const session = getImportSession(sharedUrl)
    if (session?.status === 'done') {
      return
    }

    importStarted.current = true

    void importMutation
      .mutateAsync(sharedUrl)
      .then(() => {
        markImportDone(sharedUrl)
      })
      .catch(error => {
        clearImportSession(sharedUrl)
        importStarted.current = false
        setImportError(formatImportError(error))
      })
  }, [auth.authenticated, authLoading, importMutation, sharedUrl])

  const showImportError = Boolean(importError || importMutation.isError)
  const errorMessage =
    importError ??
    (importMutation.error ? formatImportError(importMutation.error) : "Couldn't import this recipe.")

  function handleRetryImport() {
    if (!sharedUrl) {
      return
    }

    clearImportSession(sharedUrl)
    importStarted.current = true
    setImportError(null)
    importMutation.reset()

    void importMutation
      .mutateAsync(sharedUrl)
      .then(() => {
        markImportDone(sharedUrl)
      })
      .catch(error => {
        clearImportSession(sharedUrl)
        importStarted.current = false
        setImportError(formatImportError(error))
      })
  }

  function handleManualImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = manualUrl.trim()
    if (!url) {
      return
    }

    navigate(buildImportPath(url), { replace: true })
  }

  if (authLoading || (!auth.authenticated && !showImportError)) {
    return <ImportStatus message="Checking sign-in..." />
  }

  if (!auth.authenticated) {
    return <ImportStatus message="Redirecting to sign in..." />
  }

  if (sharedUrl && importMutation.isPending) {
    return (
      <ImportStatus
        detail="This can take up to a minute for some sites."
        message="Importing recipe..."
        subtitle={sharedUrl}
        subtitleBreakAll
      />
    )
  }

  if (sharedUrl && importMutation.isSuccess && importMutation.data.kind === 'existing') {
    return (
      <ImportStatus
        detail="Opening existing recipe..."
        message="This recipe already exists"
        subtitle={importMutation.data.recipe.title}
      />
    )
  }

  if (showImportError) {
    const editorPath = sharedUrl
      ? `/recipes/new?url=${encodeURIComponent(sharedUrl)}`
      : '/recipes/new'

    return (
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <h1 className="text-2xl font-bold">Couldn't import recipe</h1>
        <p className="mt-2 text-sm text-red-700">{errorMessage}</p>
        {sharedUrl ? (
          <p className="mt-2 break-all text-sm text-stone-600">{sharedUrl}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={handleRetryImport} variant="secondary">
            Try again
          </Button>
          <Link
            className="inline-flex rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
            to={editorPath}
          >
            Open editor
          </Link>
          <Link
            className="inline-flex rounded-full px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-orange-100"
            to="/"
          >
            Go home
          </Link>
        </div>
      </section>
    )
  }

  if (sharedUrl && importMutation.isSuccess) {
    return <ImportStatus message="Opening recipe..." />
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
      <h1 className="text-2xl font-bold">Import recipe</h1>
      <p className="mt-2 text-stone-600">
        Paste a recipe URL to import it automatically, or share a link to this app from your
        browser.
      </p>
      <form className="mt-6 space-y-4" onSubmit={handleManualImport}>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Recipe URL</span>
          <input
            className="mt-1 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2"
            onChange={event => setManualUrl(event.target.value)}
            placeholder="https://example.com/recipe"
            type="url"
            value={manualUrl}
          />
        </label>
        <Button className="w-full" disabled={!manualUrl.trim()} type="submit">
          Import recipe
        </Button>
      </form>
    </section>
  )
}

function ImportStatus({
  detail,
  message,
  subtitle,
  subtitleBreakAll = false,
}: {
  detail?: string
  message: string
  subtitle?: string
  subtitleBreakAll?: boolean
}) {
  return (
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-orange-100">
      <p className="text-lg font-semibold text-stone-800">{message}</p>
      {subtitle ? (
        <p
          className={`mt-2 text-sm text-stone-600 ${subtitleBreakAll ? 'break-all' : 'text-base text-stone-700'}`}
        >
          {subtitle}
        </p>
      ) : null}
      {detail ? <p className="mt-2 text-sm text-stone-500">{detail}</p> : null}
    </section>
  )
}
