import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { createRecipe, importRecipe, updateRecipe } from './api'
import { useAuth } from './AuthContext'
import { Button } from './components/Button'
import { Dialog } from './components/Dialog'
import { TabPanel, Tabs } from './components/Tabs'
import { TagMultiSelect } from './components/TagMultiSelect'
import { getLocalTags } from './db'
import { useRecipeSync } from './RecipeSyncContext'
import { loadRecipeStaleFirst, storeRecipe } from './sync'

const emptyBody = 'Add @ingredient{1%cup}.\n'

interface RecipeEditPageProps {
  mode: 'edit' | 'new'
}

export function RecipeEditPage({ mode }: RecipeEditPageProps) {
  const { '*': slug = '' } = useParams()
  const { auth } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { revision, sync } = useRecipeSync()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [activeTab, setActiveTab] = useState('info')
  const [baseMetadata, setBaseMetadata] = useState<Record<string, unknown>>({})
  const [bookmarked, setBookmarked] = useState(false)
  const [body, setBody] = useState(emptyBody)
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false)
  const [ingredientName, setIngredientName] = useState('')
  const [ingredientQuantity, setIngredientQuantity] = useState('')
  const [ingredientUnit, setIngredientUnit] = useState('')
  const [lastCursor, setLastCursor] = useState(0)
  const [recipeSlug, setRecipeSlug] = useState(mode === 'new' ? 'new-recipe' : slug)
  const [servings, setServings] = useState(4)
  const [source, setSource] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [time, setTime] = useState('')
  const [title, setTitle] = useState('New Recipe')
  const isNew = mode === 'new'
  const recipeQuery = useQuery({
    enabled: auth.authenticated && !isNew && Boolean(slug),
    queryFn: () =>
      loadRecipeStaleFirst(slug, updated =>
        queryClient.setQueryData(['recipe', slug], updated),
      ),
    queryKey: ['recipe', slug],
  })

  useEffect(() => {
    if (!auth.authenticated) {
      return
    }
    getLocalTags().then(setAvailableTags)
  }, [auth.authenticated, revision])

  const saveMutation = useMutation({
    mutationFn: () => {
      const content = buildContent()
      return isNew ? createRecipe(recipeSlug, content) : updateRecipe(slug, content)
    },
    onSuccess: async recipe => {
      await storeRecipe(recipe)
      await sync()
      queryClient.setQueryData(['recipe', recipe.slug], recipe)
      navigate(`/recipes/${recipe.slug}`)
    },
  })
  const importMutation = useMutation({
    mutationFn: (url: string) => importRecipe(url),
    onSuccess: preview => {
      const parsed = parseImportedDocument(preview.content)
      setRecipeSlug(preview.suggested_slug)
      applyDocumentState(parsed.metadata, parsed.body, { skipTags: true })
      setImportUrl('')
    },
  })
  const reimportMutation = useMutation({
    mutationFn: (url: string) => importRecipe(url),
    onSuccess: preview => {
      const parsed = parseImportedDocument(preview.content)
      const currentBookmarked = bookmarked
      const currentTags = tags
      applyDocumentState(parsed.metadata, parsed.body, { skipTags: true })
      setBookmarked(currentBookmarked)
      setTags(currentTags)
    },
  })

  useEffect(() => {
    if (recipeQuery.data) {
      const bodyContent = splitDocument(recipeQuery.data.content).body
      applyDocumentState(recipeQuery.data.metadata, bodyContent)
      setBookmarked(recipeQuery.data.bookmarked)
      setRecipeSlug(recipeQuery.data.slug)
    }
  }, [recipeQuery.data])

  if (!auth.authenticated) {
    return (
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <p className="mt-2 text-stone-600">Editor access is required to change recipe files.</p>
        <Link
          className="mt-6 inline-flex rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          to="/login"
        >
          Sign in
        </Link>
      </section>
    )
  }

  if (!isNew && recipeQuery.isLoading) {
    return <p className="rounded-2xl bg-white p-6 text-stone-600">Loading recipe...</p>
  }

  if (!isNew && !recipeQuery.data) {
    return <p className="rounded-2xl bg-white p-6 text-stone-600">Recipe not found.</p>
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
              {isNew ? 'New recipe' : 'Edit recipe'}
            </p>
            <h1 className="mt-2 text-3xl font-bold">{title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isNew ? (
              <Button
                disabled={!source.trim() || reimportMutation.isPending}
                onClick={handleReimportFromSource}
                variant="secondary"
              >
                {reimportMutation.isPending ? 'Importing...' : 'Re Import'}
              </Button>
            ) : null}
            <Button onClick={handleCancel} variant="ghost">
              Cancel
            </Button>
            <Button disabled={saveMutation.isPending || !recipeSlug.trim()} onClick={handleSave}>
              {saveMutation.isPending ? 'Saving...' : isNew ? 'Create recipe' : 'Save recipe'}
            </Button>
          </div>
        </div>

        {isNew ? <ImportPanel /> : null}

        <div className="mt-6">
          <Tabs
            active={activeTab}
            items={[
              { id: 'info', label: 'Info' },
              { id: 'recipe', label: 'Recipe' },
            ]}
            onChange={setActiveTab}
          />
        </div>

        <div className="mt-6">
          <TabPanel active={activeTab} id="info">
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Title">
                <input className={inputClassName} onChange={event => setTitle(event.target.value)} value={title} />
              </Field>
              <Field label="Slug">
                <input
                  className={inputClassName}
                  disabled={!isNew}
                  onChange={event => setRecipeSlug(event.target.value)}
                  value={recipeSlug}
                />
              </Field>
              <Field label="Servings">
                <input
                  className={inputClassName}
                  min="1"
                  onChange={event => setServings(Number(event.target.value) || 1)}
                  type="number"
                  value={servings}
                />
              </Field>
              <Field label="Time">
                <input className={inputClassName} onChange={event => setTime(event.target.value)} value={time} />
              </Field>
              <Field label="Image URL">
                <input className={inputClassName} onChange={event => setImage(event.target.value)} value={image} />
              </Field>
              <Field className="lg:col-span-2" label="Source URL">
                <input
                  className={inputClassName}
                  onChange={event => setSource(event.target.value)}
                  value={source}
                />
                {!isNew && reimportMutation.error ? (
                  <p className="mt-2 text-sm text-red-700">{reimportMutation.error.message}</p>
                ) : null}
              </Field>
              <label className="flex items-center gap-3 rounded-xl bg-orange-50 px-3 py-2 text-sm font-semibold text-stone-700">
                <input
                  checked={bookmarked}
                  className="h-4 w-4 accent-orange-600"
                  onChange={event => setBookmarked(event.target.checked)}
                  type="checkbox"
                />
                Bookmarked
              </label>
              <Field className="lg:col-span-2" label="Description">
                <textarea
                  className={`${inputClassName} min-h-24`}
                  onChange={event => setDescription(event.target.value)}
                  value={description}
                />
              </Field>
              <Field className="lg:col-span-2" label="Tags">
                <TagMultiSelect
                  availableTags={availableTags}
                  onChange={setTags}
                  value={tags}
                />
              </Field>
            </div>
          </TabPanel>

          <TabPanel active={activeTab} id="recipe">
            <div className="mb-3 flex justify-end">
              <Button onClick={() => setIngredientDialogOpen(true)} variant="secondary">
                Add ingredient
              </Button>
            </div>
            <textarea
              className="min-h-128 w-full rounded-xl border border-orange-200 bg-orange-50 p-3 font-mono text-sm outline-none ring-orange-500 focus:ring-2"
              onChange={handleBodyChange}
              onClick={rememberCursor}
              onKeyUp={rememberCursor}
              ref={textareaRef}
              value={body}
            />
          </TabPanel>
        </div>
        {saveMutation.error ? (
          <p className="mt-2 text-sm text-red-700">{saveMutation.error.message}</p>
        ) : null}
      </div>

      <Dialog labelledBy="ingredient-dialog-title" open={ingredientDialogOpen}>
        <h2 className="text-xl font-bold" id="ingredient-dialog-title">
          Add ingredient
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Quantity">
            <input
              className={inputClassName}
              onChange={event => setIngredientQuantity(event.target.value)}
              placeholder="1"
              value={ingredientQuantity}
            />
          </Field>
          <Field label="Unit">
            <input
              className={inputClassName}
              onChange={event => setIngredientUnit(event.target.value)}
              placeholder="cup"
              value={ingredientUnit}
            />
          </Field>
          <Field label="Ingredient">
            <input
              className={inputClassName}
              onChange={event => setIngredientName(event.target.value)}
              placeholder="flour"
              value={ingredientName}
            />
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setIngredientDialogOpen(false)} variant="ghost">
            Cancel
          </Button>
          <Button disabled={!ingredientName.trim()} onClick={insertIngredient}>
            Add ingredient
          </Button>
        </div>
      </Dialog>
    </section>
  )

  function ImportPanel() {
    return (
      <form className="mt-6 rounded-2xl bg-orange-50 p-4" onSubmit={handleImport}>
        <h2 className="font-semibold">Import via URL</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            className={inputClassName}
            onChange={event => setImportUrl(event.target.value)}
            placeholder="https://example.com/recipe"
            type="url"
            value={importUrl}
          />
          <Button disabled={!importUrl || importMutation.isPending} type="submit">
            {importMutation.isPending ? 'Importing...' : 'Import'}
          </Button>
        </div>
        {importMutation.error ? (
          <p className="mt-2 text-sm text-red-700">{importMutation.error.message}</p>
        ) : null}
      </form>
    )
  }

  function applyDocumentState(
    metadata: Record<string, unknown>,
    nextBody: string,
    options: { skipTags?: boolean } = {}
  ) {
    setBaseMetadata(metadata)
    setTitle(getString(metadata.title) || 'New Recipe')
    if (!options.skipTags) {
      setTags(getTagsFromMetadata(metadata.tags))
    }
    setServings(getNumber(metadata.servings) || getNumber(metadata.serves) || 1)
    setImage(getString(metadata.image) || getString(metadata.picture))
    setSource(getString(metadata.source))
    setTime(getString(metadata.time) || getString(metadata.duration))
    setDescription(getString(metadata.description) || getString(metadata.introduction))
    setBookmarked(getBoolean(metadata.bookmarked))
    setBody(nextBody || emptyBody)
  }

  function buildContent() {
    const metadata = {
      ...baseMetadata,
      bookmarked,
      description: description.trim() || undefined,
      image: image.trim() || undefined,
      servings,
      source: source.trim() || undefined,
      tags,
      time: time.trim() || undefined,
      title: title.trim() || 'Untitled Recipe',
    }
    return renderDocument(metadata, body)
  }

  function handleBodyChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setBody(event.target.value)
    setLastCursor(event.target.selectionStart)
  }

  function handleCancel() {
    navigate(isNew ? '/' : `/recipes/${slug}`)
  }

  async function handleSave() {
    await saveMutation.mutateAsync()
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await importMutation.mutateAsync(importUrl.trim())
  }

  async function handleReimportFromSource() {
    const url = source.trim()
    if (!url) {
      return
    }

    const confirmed = window.confirm(
      'Re-importing will overwrite the current recipe title, metadata, and body with the latest version from the source URL. Do you want to continue?'
    )
    if (!confirmed) {
      return
    }

    await reimportMutation.mutateAsync(url)
  }

  function insertIngredient() {
    const name = ingredientName.trim()
    const quantity = ingredientQuantity.trim()
    const unit = ingredientUnit.trim()
    const amount = unit ? `${quantity}%${unit}` : quantity
    const marker = `@${name}{${amount}}`
    const nextBody = `${body.slice(0, lastCursor)}${marker}${body.slice(lastCursor)}`
    setBody(nextBody)
    setIngredientName('')
    setIngredientQuantity('')
    setIngredientUnit('')
    setIngredientDialogOpen(false)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(lastCursor + marker.length, lastCursor + marker.length)
    })
  }

  function rememberCursor() {
    setLastCursor(textareaRef.current?.selectionStart ?? 0)
  }
}

const inputClassName =
  'w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2 disabled:bg-stone-100 disabled:text-stone-500'

function Field({ children, className = '', label }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-semibold text-stone-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

interface FieldProps {
  children: ReactNode
  className?: string
  label: string
}

function splitDocument(content: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) {
    return { body: content.replace(/^\n+/, '') }
  }
  return { body: content.slice(match[0].length) }
}

function parseImportedDocument(content: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) {
    return { body: content, metadata: {} }
  }
  return { body: content.slice(match[0].length), metadata: parseSimpleMetadata(match[1]) }
}

function parseSimpleMetadata(frontMatter: string) {
  const metadata: Record<string, unknown> = {}
  const lines = frontMatter.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const pair = line.match(/^([^:#]+):\s*(.*)$/)
    if (!pair) {
      continue
    }
    const key = pair[1].trim()
    const rawValue = pair[2].trim()
    if (rawValue) {
      metadata[key] = parseScalar(rawValue)
      continue
    }
    const list: string[] = []
    while (lines[index + 1]?.trim().startsWith('- ')) {
      index += 1
      list.push(lines[index].trim().slice(2).trim())
    }
    metadata[key] = list
  }
  return metadata
}

function renderDocument(metadata: Record<string, unknown>, body: string) {
  const lines = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && !isEmptyArray(value))
    .flatMap(([key, value]) => renderMetadataValue(key, value))
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`
}

function renderMetadataValue(key: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return [key + ':', ...value.map(item => `  - ${escapeScalar(String(item))}`)]
  }
  if (typeof value === 'boolean') {
    return [`${key}: ${value ? 'true' : 'false'}`]
  }
  if (typeof value === 'number') {
    return [`${key}: ${value}`]
  }
  return [`${key}: ${escapeScalar(String(value))}`]
}

function escapeScalar(value: string) {
  return value.includes(':') || value.includes('#') ? JSON.stringify(value) : value
}

function parseScalar(value: string) {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  const numeric = Number(value)
  return Number.isNaN(numeric) ? value.replace(/^['"]|['"]$/g, '') : numeric
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function getNumber(value: unknown) {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const match = value.match(/\d+(?:\.\d+)?/)
    return match ? Number(match[0]) : 0
  }
  return 0
}

function getBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }
  return typeof value === 'string' && ['1', 'true', 'yes', 'y'].includes(value.toLowerCase())
}

function getTagsFromMetadata(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map(tag => tag.trim()).filter(Boolean)
  }
  return []
}

function isEmptyArray(value: unknown) {
  return Array.isArray(value) && value.length === 0
}
