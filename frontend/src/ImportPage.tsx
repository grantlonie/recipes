import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { importRecipe } from './api'
import { useAuth } from './AuthContext'
import { Button } from './components/Button'
import { ImportMappingDialog } from './components/ImportMappingDialog'
import { useIngredientCatalog } from './IngredientCatalogContext'
import {
  applyImportMapping,
  type MappingRow,
  type PendingImport,
} from './importMapping'
import {
  buildImportContent,
  finalizeImportedRecipe,
  persistImportedRecipe,
  prepareImportMapping,
} from './importRecipeFlow'
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
import { cardClassName, inputClassName } from './themeClasses'

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
  const { ingredients: catalog, refresh: refreshCatalog } = useIngredientCatalog()
  const importStarted = useRef(false)
  const [manualUrl, setManualUrl] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([])
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [pendingPreview, setPendingPreview] = useState<ImportPreview | null>(null)

  const sharedUrl = extractRecipeUrl({
    text: searchParams.get('text'),
    url: searchParams.get('url'),
  })

  useEffect(() => {
    importStarted.current = false
    setImportError(null)
    clearPendingMapping()
  }, [sharedUrl])

  function clearPendingMapping() {
    setMappingOpen(false)
    setMappingRows([])
    setPendingImport(null)
    setPendingPreview(null)
  }

  function openCreatedRecipe(recipe: RecipeDetail) {
    if (sharedUrl) {
      markImportDone(sharedUrl)
    }
    queryClient.setQueryData(['recipe', recipe.slug], recipe)
    addRecentRecipe(recipe)
    navigate(`/recipes/${recipe.slug}`, { replace: true })
  }

  const saveMutation = useMutation({
    mutationFn: async ({ content, preview }: { content: string; preview: ImportPreview }) => {
      const recipe = await finalizeImportedRecipe(content, preview.suggested_slug)
      await persistImportedRecipe(recipe, sync)
      return recipe
    },
    onSuccess: recipe => {
      setImportError(null)
      clearPendingMapping()
      openCreatedRecipe(recipe)
    },
    onError: error => {
      setImportError(formatImportError(error))
      if (pendingImport) {
        setMappingOpen(true)
      }
    },
  })

  const importMutation = useMutation({
    mutationFn: async (recipeUrl: string): Promise<ImportResult> => {
      const existing = await findRecipeBySourceUrl(recipeUrl)
      if (existing) {
        return { kind: 'existing', recipe: existing }
      }

      const preview = await importRecipe(recipeUrl)
      return { kind: 'preview', preview }
    },
    onError: error => {
      setImportError(formatImportError(error))
    },
    onSuccess: result => {
      setImportError(null)

      if (result.kind === 'existing') {
        if (sharedUrl) {
          markImportDone(sharedUrl)
        }
        addRecentRecipe(result.recipe)
        window.setTimeout(() => {
          navigate(`/recipes/${result.recipe.slug}`, { replace: true })
        }, 1500)
        return
      }

      if (result.kind !== 'preview') {
        return
      }

      const prepared = prepareImportMapping(result.preview, catalog)
      if (!prepared) {
        void saveMutation.mutateAsync({
          content: result.preview.content,
          preview: result.preview,
        })
        return
      }

      setPendingPreview(result.preview)
      setPendingImport(prepared.pendingImport)
      setMappingRows(prepared.mappingRows)
      setMappingOpen(true)
    },
  })

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
      setImportError(formatImportError(error))
    })
  }, [auth.authenticated, authLoading, importMutation, sharedUrl])

  const showImportError = Boolean(importError || importMutation.isError || saveMutation.isError)
  const errorMessage =
    importError ??
    (saveMutation.error
      ? formatImportError(saveMutation.error)
      : importMutation.error
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
    saveMutation.reset()
    clearPendingMapping()

    void importMutation.mutateAsync(sharedUrl).catch(error => {
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

  async function applyMapping() {
    if (!pendingImport || !pendingPreview) {
      return
    }

    const { body } = await applyImportMapping(pendingImport, mappingRows, catalog, refreshCatalog)
    const content = buildImportContent(pendingImport.metadata, body)
    setMappingOpen(false)
    await saveMutation.mutateAsync({ content, preview: pendingPreview })
  }

  function updateMappingRow(index: number, patch: Partial<MappingRow>) {
    setMappingRows(current =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    )
  }

  const busy = importMutation.isPending || saveMutation.isPending

  if (authLoading || (!auth.authenticated && !showImportError)) {
    return <ImportStatus message="Checking sign-in..." />
  }

  if (!auth.authenticated) {
    return <ImportStatus message="Redirecting to sign in..." />
  }

  if (sharedUrl && busy && !mappingOpen) {
    return (
      <ImportStatus
        detail="This can take up to a minute for some sites."
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

  if (showImportError && !mappingOpen) {
    const editorPath = sharedUrl
      ? `/recipes/new?url=${encodeURIComponent(sharedUrl)}`
      : '/recipes/new'

    return (
      <section className={`mx-auto max-w-md ${cardClassName}`}>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Couldn't import recipe</h1>
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
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

  if (sharedUrl && saveMutation.isSuccess) {
    return <ImportStatus message="Opening recipe..." />
  }

  return (
    <>
      <ImportMappingDialog
        applying={saveMutation.isPending}
        catalog={catalog}
        onApply={() => void applyMapping()}
        onCancel={() => {
          clearPendingMapping()
          setImportError(null)
          importStarted.current = false
          if (sharedUrl) {
            clearImportSession(sharedUrl)
          }
        }}
        onUpdateRow={updateMappingRow}
        open={mappingOpen}
        rows={mappingRows}
      />

      <section className={`mx-auto max-w-md ${cardClassName}`}>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Import recipe</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          Paste a recipe URL to import it automatically, or share a link to this app from your
          browser.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleManualImport}>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Recipe URL</span>
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
    </>
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
