import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent } from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { getRecipe, updateRecipe } from './api'
import { useAuth } from './AuthContext'

export function RecipeEditPage() {
  const { '*': slug = '' } = useParams()
  const { auth } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const [syntaxHelpOpen, setSyntaxHelpOpen] = useState(false)
  const recipeQuery = useQuery({
    enabled: auth.authenticated && Boolean(slug),
    queryFn: () => getRecipe(slug),
    queryKey: ['recipe', slug],
  })
  const saveMutation = useMutation({
    mutationFn: () => updateRecipe(slug, content),
    onSuccess: recipe => {
      setContent(recipe.content)
      queryClient.setQueryData(['recipe', slug], recipe)
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })

  useEffect(() => {
    if (recipeQuery.data) {
      setContent(recipeQuery.data.content)
    }
  }, [recipeQuery.data])

  if (!auth.authenticated) {
    return (
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <h1 className="text-2xl font-bold">Sign in to edit recipes</h1>
        <p className="mt-2 text-stone-600">Editor access is required to change recipe files.</p>
        <Link
          className="mt-6 inline-flex rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          to="/editor"
        >
          Editor login
        </Link>
      </section>
    )
  }

  if (recipeQuery.isLoading) {
    return <p className="rounded-2xl bg-white p-6 text-stone-600">Loading recipe...</p>
  }

  if (!recipeQuery.data) {
    return <p className="rounded-2xl bg-white p-6 text-stone-600">Recipe not found.</p>
  }

  const hasUnsavedChanges = content !== recipeQuery.data.content

  return (
    <section className="space-y-6">
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
              Edit plain text
            </p>
            <h1 className="mt-2 text-3xl font-bold">{recipeQuery.data.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-200"
              onClick={() => setSyntaxHelpOpen(true)}
              type="button"
            >
              Ingredient syntax
            </button>
            <button
              className="rounded-full px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100"
              onClick={handleCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
              disabled={saveMutation.isPending}
              onClick={handleSave}
              type="button"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save recipe'}
            </button>
          </div>
        </div>

        <textarea
          className="mt-6 min-h-128 w-full rounded-xl border border-orange-200 bg-orange-50 p-3 font-mono text-sm outline-none ring-orange-500 focus:ring-2"
          onChange={handleContentChange}
          value={content}
        />
        {saveMutation.error ? (
          <p className="mt-2 text-sm text-red-700">{saveMutation.error.message}</p>
        ) : null}
      </div>

      {syntaxHelpOpen ? (
        <div
          aria-labelledby="ingredient-syntax-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
          role="dialog"
        >
          <div className="max-w-lg rounded-3xl bg-white p-6 shadow-xl ring-1 ring-orange-100">
            <h2 className="text-xl font-bold" id="ingredient-syntax-title">
              Ingredient syntax
            </h2>
            <p className="mt-3 text-sm text-stone-700">
              Wrap ingredients with <code className="font-mono">@</code> and braces so they show up
              in the ingredients list. Put the quantity before <code className="font-mono">%</code>{' '}
              and the unit after it, like{' '}
              <code className="font-mono">@flour&#123;2%cups&#125;</code>.
            </p>
            <p className="mt-3 text-sm text-stone-700">
              Use empty braces for ingredients without an amount, like{' '}
              <code className="font-mono">@salt&#123;&#125;</code>. The text inside the braces is
              parsed as <code className="font-mono">quantity%unit</code>.
            </p>
            <button
              className="mt-6 rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
              onClick={() => setSyntaxHelpOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )

  function handleContentChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setContent(event.target.value)
  }

  function handleCancel() {
    if (
      hasUnsavedChanges &&
      !window.confirm('You have unsaved changes. Cancel editing and discard them?')
    ) {
      return
    }
    navigate(`/recipes/${slug}`)
  }

  async function handleSave() {
    await saveMutation.mutateAsync()
    navigate(`/recipes/${slug}`)
  }
}
