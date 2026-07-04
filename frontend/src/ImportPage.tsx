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
  ensureUniqueSlug,
  extractRecipeUrl,
} from './shareImport'
import { storeRecipe } from './sync'

export function ImportPage() {
  const { auth, authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { sync } = useRecipeSync()
  const { addRecentRecipe } = useRecipeListState()
  const importStarted = useRef(false)
  const [manualUrl, setManualUrl] = useState('')

  const sharedUrl = extractRecipeUrl({
    text: searchParams.get('text'),
    url: searchParams.get('url'),
  })

  useEffect(() => {
    importStarted.current = false
  }, [sharedUrl])

  const importMutation = useMutation({
    mutationFn: async (recipeUrl: string) => {
      const preview = await importRecipe(recipeUrl)
      const slug = await ensureUniqueSlug(preview.suggested_slug)
      const recipe = await createRecipe(slug, preview.content)
      await storeRecipe(recipe)
      await sync()
      return recipe
    },
    onSuccess: recipe => {
      queryClient.setQueryData(['recipe', recipe.slug], recipe)
      addRecentRecipe(recipe)
      navigate(`/recipes/${recipe.slug}`, { replace: true })
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

    const storageKey = `share-import:${sharedUrl}`
    const status = sessionStorage.getItem(storageKey)
    if (status === 'done' || status === 'pending') {
      return
    }

    importStarted.current = true
    sessionStorage.setItem(storageKey, 'pending')

    void importMutation
      .mutateAsync(sharedUrl)
      .then(() => {
        sessionStorage.setItem(storageKey, 'done')
      })
      .catch(() => {
        sessionStorage.removeItem(storageKey)
        importStarted.current = false
      })
  }, [auth.authenticated, authLoading, importMutation, sharedUrl])

  if (authLoading || (!auth.authenticated && !importMutation.isError)) {
    return <ImportStatus message="Checking sign-in..." />
  }

  if (!auth.authenticated) {
    return <ImportStatus message="Redirecting to sign in..." />
  }

  if (sharedUrl && importMutation.isPending) {
    return <ImportStatus message="Importing recipe..." subtitle={sharedUrl} />
  }

  if (importMutation.isError) {
    const editorPath = sharedUrl
      ? `/recipes/new?url=${encodeURIComponent(sharedUrl)}`
      : '/recipes/new'

    return (
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <h1 className="text-2xl font-bold">Import failed</h1>
        <p className="mt-2 text-sm text-red-700">{importMutation.error.message}</p>
        {sharedUrl ? (
          <p className="mt-2 break-all text-sm text-stone-600">{sharedUrl}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              if (sharedUrl) {
                sessionStorage.removeItem(`share-import:${sharedUrl}`)
              }
              importStarted.current = false
              importMutation.reset()
            }}
            variant="secondary"
          >
            Try again
          </Button>
          <Link
            className="inline-flex rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
            to={editorPath}
          >
            Open editor
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

  function handleManualImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = manualUrl.trim()
    if (!url) {
      return
    }

    navigate(buildImportPath(url), { replace: true })
  }
}

function ImportStatus({ message, subtitle }: { message: string; subtitle?: string }) {
  return (
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-orange-100">
      <p className="text-lg font-semibold text-stone-800">{message}</p>
      {subtitle ? <p className="mt-2 break-all text-sm text-stone-500">{subtitle}</p> : null}
    </section>
  )
}
