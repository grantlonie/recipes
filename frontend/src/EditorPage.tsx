import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'

import { createRecipe } from './api'
import { useAuth } from './AuthContext'

const emptyRecipe = `---
title: New Recipe
tags: []
servings: 4
image:
source:
time:
---

Add @ingredient{1%cup}.
`

export function EditorPage() {
  const { auth, loginError, loginPending, signIn } = useAuth()
  const [importUrl, setImportUrl] = useState('')
  const [password, setPassword] = useState('')
  const [recipeContent, setRecipeContent] = useState(emptyRecipe)
  const [recipeSlug, setRecipeSlug] = useState('new-recipe')
  const [username, setUsername] = useState('editor')
  const queryClient = useQueryClient()
  const createRecipeMutation = useMutation({
    mutationFn: ({ content, slug }: RecipeInput) => createRecipe(slug, content),
    onSuccess: () => invalidateRecipes(),
  })
  if (!auth.authenticated) {
    return (
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <h1 className="text-2xl font-bold">Editor login</h1>
        <form className="mt-6 space-y-4" onSubmit={handleLogin}>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700">Username</span>
            <input
              className="mt-1 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2"
              onChange={event => setUsername(event.target.value)}
              value={username}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-stone-700">Password</span>
            <input
              className="mt-1 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2"
              onChange={event => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <button
            className="w-full rounded-full bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
            disabled={loginPending}
            type="submit"
          >
            {loginPending ? 'Signing in...' : 'Sign in'}
          </button>
          {loginError ? <p className="text-sm text-red-700">{loginError}</p> : null}
        </form>
      </section>
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold">Recipe editor</h1>
        <p className="mt-2 text-stone-600">
          Write and save plain Cooklang files. Image fields should be public URLs only.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-orange-100">
          <h2 className="text-xl font-semibold">Import from URL</h2>
          <p className="mt-2 text-sm text-stone-600">
            Open Cookify in a new tab, then paste the converted Cooklang into the create form.
          </p>
          <form className="mt-4 space-y-4" onSubmit={handleImport}>
            <input
              className="w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2"
              onChange={event => setImportUrl(event.target.value)}
              placeholder="https://example.com/recipe"
              type="url"
              value={importUrl}
            />
            <button
              className="rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
              disabled={!importUrl}
              type="submit"
            >
              Open in Cookify
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-orange-100">
          <h2 className="text-xl font-semibold">Create recipe</h2>
          <RecipeSaveForm
            content={recipeContent}
            label="Create recipe"
            onContentChange={setRecipeContent}
            onSave={handleCreateRecipe}
            onSlugChange={setRecipeSlug}
            pending={createRecipeMutation.isPending}
            slug={recipeSlug}
          />
        </section>
      </div>
    </div>
  )

  async function handleCreateRecipe() {
    await createRecipeMutation.mutateAsync({ content: recipeContent, slug: recipeSlug })
  }

  function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    window.open(`https://cook.md/${importUrl.trim()}`, '_blank', 'noopener,noreferrer')
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await signIn(username, password)
  }

  function invalidateRecipes() {
    queryClient.invalidateQueries({ queryKey: ['recipes'] })
    queryClient.invalidateQueries({ queryKey: ['tags'] })
  }
}

interface RecipeInput {
  content: string
  slug: string
}

interface RecipeSaveFormProps {
  content: string
  label: string
  onContentChange: (value: string) => void
  onSave: () => Promise<void>
  onSlugChange: (value: string) => void
  pending: boolean
  slug: string
}

function RecipeSaveForm({
  content,
  label,
  onContentChange,
  onSave,
  onSlugChange,
  pending,
  slug,
}: RecipeSaveFormProps) {
  return (
    <div className="mt-4 space-y-4">
      <input
        className="w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2"
        onChange={event => onSlugChange(event.target.value)}
        placeholder="recipe-slug"
        value={slug}
      />
      <textarea
        className="min-h-80 w-full rounded-xl border border-orange-200 bg-orange-50 p-3 font-mono text-sm outline-none ring-orange-500 focus:ring-2"
        onChange={event => onContentChange(event.target.value)}
        value={content}
      />
      <button
        className="rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
        disabled={pending || !slug}
        onClick={onSave}
        type="button"
      >
        {pending ? 'Saving...' : label}
      </button>
    </div>
  )
}
