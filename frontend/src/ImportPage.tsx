import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { importRecipe } from './api'
import { useAuth } from './AuthContext'
import { Button } from './components/Button'
import { useImportProgress } from './ImportProgressContext'
import { finalizeImportedRecipe, persistImportedRecipe } from './importRecipeFlow'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import {
  buildImportPath,
  clearImportSession,
  extractRecipeUrl,
  findRecipeBySourceUrl,
  formatImportError,
  getImportSession,
  markImportDone,
} from './shareImport'
import type { ImportPreview, RecipeDetail, RecipeSummary } from './types'
import { cardClassName, errorTextClassName, inputClassName } from './themeClasses'

type ImportResult =
  | { kind: 'existing'; recipe: RecipeSummary }
  | { kind: 'preview'; preview: ImportPreview }

export function ImportPage() {
  const { auth, authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { sync } = useRecipeSync()
  const { addRecentRecipe } = useRecipeListState()
  const { startImport, updateProgress, completeImport, failImport } = useImportProgress()
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

  function openCreatedRecipe(recipe: RecipeDetail) {
    if (sharedUrl) {
      markImportDone(sharedUrl)
    }
    queryClient.setQueryData(['recipe', recipe.slug], recipe)
    addRecentRecipe(recipe)
    navigate(`/recipes/${recipe.slug}`, { replace: true })
  }

  const importMutation = useMutation({
    mutationFn: async (recipeUrl: string): Promise<ImportResult> => {
      const existing = await findRecipeBySourceUrl(recipeUrl)
      if (existing) {
        return { kind: 'existing', recipe: existing }
      }

      const preview = await importRecipe(recipeUrl)
      return { kind: 'preview', preview }
    },
    onMutate: () => {
      startImport({ title: 'Importing recipe', total: 1 })
      updateProgress({ status: 'Fetching and parsing…' })
    },
    onError: error => {
      const message = formatImportError(error)
      setImportError(message)
      failImport(message)
    },
    onSuccess: result => {
      setImportError(null)

      if (result.kind === 'existing') {
        if (sharedUrl) {
          markImportDone(sharedUrl)
        }
        addRecentRecipe(result.recipe)
        completeImport({ saved: 0, skipped: 1, unmatchedCount: 0 })
        window.setTimeout(() => {
          navigate(`/recipes/${result.recipe.slug}`, { replace: true })
        }, 1500)
        return
      }

      void savePreview(result.preview)
    },
  })

  async function savePreview(preview: ImportPreview) {
    const unmatchedCount = uniqueUnmatchedCount(preview.unmatched_ingredients)
    updateProgress({ status: 'Saving…' })
    try {
      const recipe = await finalizeImportedRecipe(preview.content, preview.suggested_slug)
      await persistImportedRecipe(recipe, sync)
      completeImport({ saved: 1, unmatchedCount })
      openCreatedRecipe(recipe)
    } catch (error) {
      const message = formatImportError(error)
      setImportError(message)
      failImport(message)
      importStarted.current = false
    }
  }

  useEffect(() => {
    if (authLoading || !auth.authenticated || !sharedUrl || importStarted.current) {
      return
    }

    const session = getImportSession(sharedUrl)
    if (session?.status === 'done') {
      return
    }

    importStarted.current = true

    void importMutation.mutateAsync(sharedUrl).catch(error => {
      clearImportSession(sharedUrl)
      importStarted.current = false
      const message = formatImportError(error)
      setImportError(message)
      failImport(message)
    })
  }, [auth.authenticated, authLoading, failImport, importMutation, sharedUrl])

  const showImportError = Boolean(importError || importMutation.isError)
  const errorMessage =
    importError ??
    (importMutation.error
      ? formatImportError(importMutation.error)
      : "Couldn't import this recipe.")

  function handleRetryImport() {
    if (!sharedUrl) {
      return
    }

    clearImportSession(sharedUrl)
    importStarted.current = true
    setImportError(null)
    importMutation.reset()

    void importMutation.mutateAsync(sharedUrl).catch(error => {
      clearImportSession(sharedUrl)
      importStarted.current = false
      const message = formatImportError(error)
      setImportError(message)
      failImport(message)
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

  const busy = importMutation.isPending

  if (authLoading || (!auth.authenticated && !showImportError)) {
    return <ImportStatus message="Checking sign-in..." />
  }

  if (!auth.authenticated) {
    return <ImportStatus message="Redirecting to sign in..." />
  }

  if (sharedUrl && busy) {
    return (
      <ImportStatus
        detail="This can take up to a minute for some sites. You can keep using the app — progress is shown below."
        message="Importing recipe..."
        subtitle={sharedUrl}
        subtitleBreakAll
      />
    )
  }

  if (sharedUrl && importMutation.isSuccess && importMutation.data?.kind === 'existing') {
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
      <section className={`mx-auto max-w-md ${cardClassName}`}>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">
          Couldn't import recipe
        </h1>
        <p className={`mt-2 text-sm ${errorTextClassName}`}>{errorMessage}</p>
        {sharedUrl ? (
          <p className="mt-2 break-all text-sm text-stone-600 dark:text-stone-400">{sharedUrl}</p>
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
            className="inline-flex rounded-full px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-orange-100 dark:text-stone-200 dark:hover:bg-stone-700"
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
    <section className={`mx-auto max-w-md ${cardClassName}`}>
      <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Import recipe</h1>
      <p className="mt-2 text-stone-600 dark:text-stone-400">
        Paste a recipe URL to import it automatically, or share a link to this app from your
        browser.
      </p>
      <form className="mt-6 space-y-4" onSubmit={handleManualImport}>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">
            Recipe URL
          </span>
          <input
            className={`mt-1 ${inputClassName}`}
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

interface ImportStatusProps {
  detail?: string
  message: string
  subtitle?: string
  subtitleBreakAll?: boolean
}

function ImportStatus({ detail, message, subtitle, subtitleBreakAll = false }: ImportStatusProps) {
  return (
    <section className={`mx-auto max-w-md text-center ${cardClassName}`}>
      <p className="text-lg font-semibold text-stone-800 dark:text-stone-100">{message}</p>
      {subtitle ? (
        <p
          className={`mt-2 text-sm text-stone-600 dark:text-stone-400 ${subtitleBreakAll ? 'break-all text-base text-stone-700 dark:text-stone-300' : ''}`}
        >
          {subtitle}
        </p>
      ) : null}
      {detail ? <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{detail}</p> : null}
    </section>
  )
}

function uniqueUnmatchedCount(names: string[] | undefined): number {
  if (!names?.length) {
    return 0
  }
  return new Set(names.map(name => name.toLowerCase())).size
}
