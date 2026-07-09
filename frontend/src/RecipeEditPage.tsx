import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isEqual } from 'lodash-es'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
  createRecipe,
  importRecipe,
  importRecipeFile,
  updateRecipe,
  uploadRecipeImage,
  uploadRecipeSource,
} from './api'
import { useAuth } from './AuthContext'
import { Autocomplete } from './components/Autocomplete'
import { Button } from './components/Button'
import { CameraCaptureDialog, isCameraCaptureSupported } from './components/CameraCaptureDialog'
import { Dialog } from './components/Dialog'
import { ImportingDialog } from './components/ImportingDialog'
import { ImportMappingDialog } from './components/ImportMappingDialog'
import { RecipeBodyEditor, type RecipeBodyEditorHandle } from './components/RecipeBodyEditor'
import { TabPanel, Tabs } from './components/Tabs'
import { TagMultiSelect } from './components/TagMultiSelect'
import { VolumeQuantitySelect } from './components/VolumeQuantitySelect'
import type { IngredientAttrs } from './cooklangTokens'
import { getLocalTags } from './db'
import {
  applyImportMapping,
  buildMappingRows,
  mappingRowsAreValid,
  parseImportedDocument,
  type MappingRow,
  type PendingImport,
} from './importMapping'
import { useIngredientCatalog } from './IngredientCatalogContext'
import { parseQuantity } from './quantities'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { buildLoginUrl, ensureUniqueSlug, slugify } from './shareImport'
import { getLocalRecipe, deleteRecipes } from './db'
import { loadRecipeStaleFirst, storeRecipe } from './sync'
import { cardClassName, inputClassName } from './themeClasses'
import type { CatalogIngredient, ImportPreview, UnitSystem } from './types'
import {
  defaultEditorUnit,
  densityForName,
  editorUnitItems,
  formatGramsValue,
  formatIngredientAmount,
  isUsCookingVolumeUnit,
  normalizeUnit,
  toGrams,
} from './units'
import { useUnitSystem } from './UnitSystemContext'

const emptyBody = 'Add @ingredient{100%g}.\n'
const MAX_SERVINGS = 12

interface IngredientFormState {
  fixed: boolean
  name: string
  note: string
  qty: string
  units: string
}

function emptyIngredientForm(): IngredientFormState {
  return { fixed: false, name: '', note: '', qty: '', units: '' }
}

function newIngredientForm(unitSystem: UnitSystem): IngredientFormState {
  return {
    fixed: false,
    name: '',
    note: '',
    qty: '1',
    units: defaultEditorUnit(unitSystem),
  }
}

function ingredientFormFromAttrs(
  attrs: IngredientAttrs,
  catalog: CatalogIngredient[],
  unitSystem: UnitSystem,
): IngredientFormState {
  const density = densityForName(attrs.name, catalog)
  const display = formatIngredientAmount(attrs.quantity || null, attrs.unit || null, {
    densityKgM3: density,
    unitSystem,
  })
  return {
    fixed: attrs.fixed,
    name: attrs.name,
    note: attrs.note,
    qty: display.quantity || attrs.quantity,
    units: normalizeUnit(display.unit) ?? '',
  }
}

function clampServings(value: number): number {
  return Math.min(MAX_SERVINGS, Math.max(1, Math.round(value)))
}

interface RecipeEditPageProps {
  mode: 'edit' | 'new'
}

export function RecipeEditPage({ mode }: RecipeEditPageProps) {
  const { '*': slug = '' } = useParams()
  const { auth } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { revision, sync } = useRecipeSync()
  const { addRecentRecipe } = useRecipeListState()
  const { unitSystem } = useUnitSystem()
  const { ingredients: catalog, refresh: refreshCatalog } = useIngredientCatalog()
  const bodyEditorRef = useRef<RecipeBodyEditorHandle | null>(null)
  const [activeTab, setActiveTab] = useState('info')
  const [baseMetadata, setBaseMetadata] = useState<Record<string, unknown>>({})
  const [bookmarked, setBookmarked] = useState(false)
  const [body, setBody] = useState(emptyBody)
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [importUrl, setImportUrl] = useState(searchParams.get('url') ?? '')
  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false)
  const [editingPos, setEditingPos] = useState<number | null>(null)
  const [ingredientInitial, setIngredientInitial] = useState<IngredientFormState>(emptyIngredientForm)
  const [ingredientDraft, setIngredientDraft] = useState<IngredientFormState>(emptyIngredientForm)
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false)
  const [editingSectionPos, setEditingSectionPos] = useState<number | null>(null)
  const [sectionTitle, setSectionTitle] = useState('')
  const [mappingOpen, setMappingOpen] = useState(false)
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([])
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
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
      loadRecipeStaleFirst(slug, updated => queryClient.setQueryData(['recipe', slug], updated)),
    queryKey: ['recipe', slug],
  })

  const selectedDensity = densityForName(ingredientDraft.name, catalog)
  const unitOptions = useMemo(() => editorUnitItems(unitSystem), [unitSystem])
  const ingredientOptions = useMemo(
    () =>
      catalog.map(item => ({
        label: item.density_kg_m3 == null ? `${item.name} (weight)` : item.name,
        value: item.name,
      })),
    [catalog],
  )
  const mappingCanApply = useMemo(
    () => mappingRowsAreValid(mappingRows, catalog),
    [mappingRows, catalog],
  )
  const ingredientDirty = editingPos !== null && !isEqual(ingredientInitial, ingredientDraft)

  useEffect(() => {
    if (!auth.authenticated) {
      return
    }
    getLocalTags().then(setAvailableTags)
  }, [auth.authenticated, revision])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const content = buildContent()
      const titleSlug = slugify(title.trim() || 'Untitled Recipe')
      if (isNew) {
        const targetSlug = await ensureUniqueSlug(titleSlug)
        const previousSlug = targetSlug !== recipeSlug ? recipeSlug : undefined
        return createRecipe(targetSlug, content, previousSlug)
      }
      const targetSlug = await ensureUniqueSlug(titleSlug, { excludeSlug: slug })
      return targetSlug !== slug
        ? updateRecipe(slug, content, targetSlug)
        : updateRecipe(slug, content)
    },
    onSuccess: async recipe => {
      await storeRecipe(recipe)
      queryClient.setQueryData(['recipe', recipe.slug], recipe)
      queryClient.removeQueries({ queryKey: ['recipe', recipe.slug, 'scale'] })
      if (!isNew && slug !== recipe.slug) {
        await deleteRecipes([slug])
        queryClient.removeQueries({ queryKey: ['recipe', slug] })
        queryClient.removeQueries({ queryKey: ['recipe', slug, 'scale'] })
      }
      await sync()
      const latest = (await getLocalRecipe(recipe.slug)) ?? recipe
      queryClient.setQueryData(['recipe', recipe.slug], latest)
      addRecentRecipe(latest)
      navigate(`/recipes/${recipe.slug}`, { replace: true })
    },
  })
  const importMutation = useMutation({
    mutationFn: (url: string) => importRecipe(url),
    onSuccess: preview => {
      handleImportPreview(preview, { suggestedSlug: preview.suggested_slug })
      setImportUrl('')
    },
  })
  const reimportMutation = useMutation({
    mutationFn: async () => {
      if (isRefFile(source)) {
        return importRecipeFile(slug)
      }
      return importRecipe(source.trim())
    },
    onSuccess: preview => {
      handleImportPreview(preview, {
        preserveBookmarked: true,
        preserveTags: true,
      })
    },
  })

  useEffect(() => {
    if (!isNew) {
      return
    }
    const baseSlug = slugify(title)
    void ensureUniqueSlug(baseSlug).then(setRecipeSlug)
  }, [isNew, title])

  useEffect(() => {
    if (recipeQuery.data) {
      const bodyContent = splitDocument(recipeQuery.data.content).body
      applyDocumentState(recipeQuery.data.metadata, bodyContent)
      setBookmarked(recipeQuery.data.bookmarked)
    }
  }, [recipeQuery.data])

  const handleEditIngredient = useCallback(
    (pos: number, attrs: IngredientAttrs) => {
      const snapshot = ingredientFormFromAttrs(attrs, catalog, unitSystem)
      setEditingPos(pos)
      setIngredientInitial(snapshot)
      setIngredientDraft(snapshot)
      setIngredientDialogOpen(true)
    },
    [catalog, unitSystem],
  )

  const handleEditSection = useCallback((pos: number, title: string) => {
    setEditingSectionPos(pos)
    setSectionTitle(title)
    setSectionDialogOpen(true)
  }, [])

  if (!auth.authenticated) {
    return (
      <section className={`mx-auto max-w-md ${cardClassName}`}>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Sign in required</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">Editor access is required to change recipe files.</p>
        <Link
          className="mt-6 inline-flex rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          to={buildLoginUrl(`${location.pathname}${location.search}`)}
        >
          Sign in
        </Link>
      </section>
    )
  }

  if (!isNew && recipeQuery.isLoading) {
    return <p className={`rounded-2xl p-6 text-stone-600 dark:text-stone-400 ${cardClassName}`}>Loading recipe...</p>
  }

  if (!isNew && !recipeQuery.data) {
    return <p className={`rounded-2xl p-6 text-stone-600 dark:text-stone-400 ${cardClassName}`}>Recipe not found.</p>
  }

  return (
    <section className="space-y-6">
      <div className={cardClassName}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
              {isNew ? 'New recipe' : 'Edit recipe'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isNew ? (
              <Button
                disabled={!source.trim() || reimportMutation.isPending}
                onClick={handleReimportFromSource}
                variant="secondary"
              >
                Re Import
              </Button>
            ) : null}
            <Button onClick={handleCancel} variant="ghost">
              Cancel
            </Button>
            <Button disabled={saveMutation.isPending || !title.trim()} onClick={handleSave}>
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
                <input
                  className={inputClassName}
                  onChange={event => setTitle(event.target.value)}
                  value={title}
                />
              </Field>
              <Field label="Servings">
                <input
                  className={inputClassName}
                  max={MAX_SERVINGS}
                  min="1"
                  onChange={event => setServings(clampServings(Number(event.target.value) || 1))}
                  type="number"
                  value={servings}
                />
              </Field>
              <Field label="Time">
                <input
                  className={inputClassName}
                  onChange={event => setTime(event.target.value)}
                  value={time}
                />
              </Field>
              <RefField
                accept="image/*"
                capture
                className="lg:col-span-2"
                label="Image"
                onUpload={handleImageUpload}
                onValueChange={setImage}
                slug={isNew ? recipeSlug : slug}
                value={image}
              />
              <RefField
                accept="image/*,.pdf,.docx,.txt,.html,.htm,.md,.markdown"
                className="lg:col-span-2"
                label="Source"
                onUpload={handleSourceUpload}
                onValueChange={setSource}
                slug={isNew ? recipeSlug : slug}
                value={source}
              />
              {!isNew && reimportMutation.error ? (
                <p className="lg:col-span-2 text-sm text-red-700">{reimportMutation.error.message}</p>
              ) : null}
              <label className="flex items-center gap-3 rounded-xl bg-orange-50 px-3 py-2 text-sm font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
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
                <TagMultiSelect availableTags={availableTags} onChange={setTags} value={tags} />
              </Field>
            </div>
          </TabPanel>

          <TabPanel active={activeTab} id="recipe">
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <Button onClick={openAddSection} variant="secondary">
                Add section
              </Button>
              <Button onClick={openAddIngredient} variant="secondary">
                Add ingredient
              </Button>
            </div>
            <RecipeBodyEditor
              catalog={catalog}
              onChange={setBody}
              onEditIngredient={handleEditIngredient}
              onEditSection={handleEditSection}
              ref={bodyEditorRef}
              unitSystem={unitSystem}
              value={body}
            />
          </TabPanel>
        </div>
        {saveMutation.error ? (
          <p className="mt-2 text-sm text-red-700">{saveMutation.error.message}</p>
        ) : null}
      </div>

      <ImportingDialog open={importMutation.isPending || reimportMutation.isPending} />

      <Dialog labelledBy="ingredient-dialog-title" open={ingredientDialogOpen}>
        <h2 className="text-xl font-bold" id="ingredient-dialog-title">
          {editingPos !== null ? 'Edit ingredient' : 'Add ingredient'}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Quantity">
            {isUsCookingVolumeUnit(ingredientDraft.units) ? (
              <VolumeQuantitySelect
                onChange={qty => setIngredientDraft(current => ({ ...current, qty }))}
                value={ingredientDraft.qty}
              />
            ) : (
              <input
                className={inputClassName}
                onChange={event =>
                  setIngredientDraft(current => ({ ...current, qty: event.target.value }))
                }
                placeholder="1"
                value={ingredientDraft.qty}
              />
            )}
          </Field>
          <Field label="Unit">
            <Autocomplete
              allowCustom={false}
              allowEmpty
              onChange={units => setIngredientDraft(current => ({ ...current, units }))}
              options={unitOptions}
              placeholder="optional"
              value={ingredientDraft.units}
            />
          </Field>
          <Field label="Ingredient">
            <Autocomplete
              onChange={name => setIngredientDraft(current => ({ ...current, name }))}
              options={ingredientOptions}
              placeholder="flour"
              value={ingredientDraft.name}
            />
          </Field>
        </div>
        <Field className="mt-4" label="Details">
          <input
            className={inputClassName}
            onChange={event =>
              setIngredientDraft(current => ({ ...current, note: event.target.value }))
            }
            placeholder="large, bittersweet, unsalted…"
            value={ingredientDraft.note}
          />
        </Field>
        <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
          <input
            checked={ingredientDraft.fixed}
            className="h-4 w-4 accent-orange-600"
            onChange={event =>
              setIngredientDraft(current => ({ ...current, fixed: event.target.checked }))
            }
            type="checkbox"
          />
          Fixed amount (does not scale)
        </label>
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          Amounts are entered in {unitSystemEntryLabel(unitSystem)} and stored as grams when
          convertible.
          {unitSystem === 'us' && selectedDensity == null
            ? ' No density on this ingredient — volume units are stored as-is (not grams).'
            : null}
        </p>
        <div className="mt-6 flex justify-between gap-2">
          {editingPos !== null ? (
            <Button onClick={deleteIngredientToken} variant="danger">
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {editingPos === null || ingredientDirty ? (
              <Button onClick={closeIngredientDialog} variant="ghost">
                Cancel
              </Button>
            ) : null}
            <Button
              className={editingPos !== null ? 'w-[80px] justify-center' : undefined}
              disabled={!ingredientDraft.name.trim()}
              onClick={confirmIngredientDialog}
            >
              {editingPos !== null ? (ingredientDirty ? 'Update' : 'Done') : 'Add ingredient'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog labelledBy="section-dialog-title" open={sectionDialogOpen}>
        <h2 className="text-xl font-bold" id="section-dialog-title">
          {editingSectionPos !== null ? 'Edit section' : 'Add section'}
        </h2>
        <Field className="mt-4" label="Section name">
          <input
            autoFocus
            className={inputClassName}
            onChange={event => setSectionTitle(event.target.value)}
            placeholder="Dough, Filling, Sauce…"
            value={sectionTitle}
          />
        </Field>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setSectionDialogOpen(false)} variant="ghost">
            Cancel
          </Button>
          <Button disabled={!sectionTitle.trim()} onClick={saveSection}>
            {editingSectionPos !== null ? 'Update section' : 'Add section'}
          </Button>
        </div>
      </Dialog>

      <ImportMappingDialog
        catalog={catalog}
        onApply={() => void applyMapping()}
        onCancel={() => setMappingOpen(false)}
        onUpdateRow={updateMappingRow}
        open={mappingOpen}
        rows={mappingRows}
      />
    </section>
  )

  function ImportPanel() {
    return (
      <form className="mt-6 rounded-2xl bg-orange-50 p-4 dark:bg-stone-800" onSubmit={handleImport}>
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
            Import
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
    setServings(clampServings(getNumber(metadata.servings) || getNumber(metadata.serves) || 1))
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
    if (!source.trim()) {
      return
    }

    const confirmed = window.confirm(
      isRefFile(source)
        ? 'Re-importing will overwrite the current recipe title, metadata, and body from the source file. Continue?'
        : 'Re-importing will overwrite the current recipe title, metadata, and body from the source URL. Continue?'
    )
    if (!confirmed) {
      return
    }

    await reimportMutation.mutateAsync()
  }

  async function handleImageUpload(file: File) {
    const path = await uploadRecipeImage(recipeSlug, file)
    setImage(path)
  }

  async function handleSourceUpload(file: File) {
    const path = await uploadRecipeSource(recipeSlug, file)
    setSource(path)
    if (file.type.startsWith('image/')) {
      setImage(path)
    }
  }

  function handleImportPreview(
    preview: ImportPreview,
    options: Omit<PendingImport, 'body' | 'metadata'> = {}
  ) {
    const parsed = parseImportedDocument(preview.content)
    const unmatched = preview.unmatched_ingredients ?? []
    if (unmatched.length === 0) {
      const currentBookmarked = bookmarked
      const currentTags = tags
      applyDocumentState(parsed.metadata, parsed.body, { skipTags: Boolean(options.preserveTags) })
      if (options.preserveBookmarked) {
        setBookmarked(currentBookmarked)
      }
      if (options.preserveTags) {
        setTags(currentTags)
      }
      if (options.suggestedSlug) {
        setRecipeSlug(options.suggestedSlug)
      }
      return
    }
    openMapping(parsed.metadata, parsed.body, { ...options, unmatchedIngredients: unmatched })
  }

  function openMapping(
    metadata: Record<string, unknown>,
    nextBody: string,
    options: Omit<PendingImport, 'body' | 'metadata'> & { unmatchedIngredients?: string[] } = {}
  ) {
    const rows = buildMappingRows(nextBody, options.unmatchedIngredients ?? [], catalog)
    setPendingImport({ body: nextBody, metadata, ...options })
    setMappingRows(rows)
    setMappingOpen(true)
  }

  function updateMappingRow(index: number, patch: Partial<MappingRow>) {
    setMappingRows(current =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    )
  }

  async function applyMapping() {
    if (!pendingImport || !mappingCanApply) {
      return
    }

    const { body: nextBody } = await applyImportMapping(
      pendingImport,
      mappingRows,
      catalog,
      refreshCatalog,
    )

    const currentBookmarked = bookmarked
    const currentTags = tags
    applyDocumentState(pendingImport.metadata, nextBody, { skipTags: true })
    if (pendingImport.preserveBookmarked) {
      setBookmarked(currentBookmarked)
    }
    if (pendingImport.preserveTags) {
      setTags(currentTags)
    } else {
      setTags(getTagsFromMetadata(pendingImport.metadata.tags))
    }
    if (pendingImport.suggestedSlug) {
      setRecipeSlug(pendingImport.suggestedSlug)
    }
    setMappingOpen(false)
    setPendingImport(null)
    setActiveTab('recipe')
  }

  function openAddSection() {
    setEditingSectionPos(null)
    setSectionTitle('')
    setSectionDialogOpen(true)
  }

  function openAddIngredient() {
    const snapshot = newIngredientForm(unitSystem)
    setEditingPos(null)
    setIngredientInitial(snapshot)
    setIngredientDraft(snapshot)
    setIngredientDialogOpen(true)
  }

  function closeIngredientDialog() {
    setIngredientDialogOpen(false)
    setEditingPos(null)
    const snapshot = emptyIngredientForm()
    setIngredientInitial(snapshot)
    setIngredientDraft(snapshot)
  }

  function confirmIngredientDialog() {
    if (editingPos !== null && !ingredientDirty) {
      closeIngredientDialog()
      return
    }
    saveIngredientToken()
  }

  function saveIngredientToken() {
    const name = ingredientDraft.name.trim()
    if (!name) {
      return
    }

    const quantityText = ingredientDraft.qty.trim()
    const unit = ingredientDraft.units.trim()
    const note = ingredientDraft.note.trim()
    let attrs: IngredientAttrs

    if (!quantityText) {
      attrs = { fixed: ingredientDraft.fixed, name, note, quantity: '', unit: '' }
    } else if (!unit) {
      attrs = { fixed: ingredientDraft.fixed, name, note, quantity: quantityText, unit: '' }
    } else {
      const quantity = parseQuantity(quantityText)
      const density = densityForName(name, catalog)
      const grams = quantity === null ? null : toGrams(quantity, unit, density)
      if (grams == null) {
        attrs = {
          fixed: ingredientDraft.fixed,
          name,
          note,
          quantity: quantityText,
          unit: normalizeUnit(unit) ?? unit,
        }
      } else {
        attrs = {
          fixed: ingredientDraft.fixed,
          name,
          note,
          quantity: formatGramsValue(grams),
          unit: 'g',
        }
      }
    }

    if (editingPos !== null) {
      bodyEditorRef.current?.updateIngredient(editingPos, attrs)
    } else {
      bodyEditorRef.current?.insertIngredient(attrs)
    }

    closeIngredientDialog()
  }

  function deleteIngredientToken() {
    if (editingPos === null) {
      return
    }

    bodyEditorRef.current?.deleteIngredient(editingPos)
    closeIngredientDialog()
  }

  function saveSection() {
    const title = sectionTitle.trim()
    if (!title) {
      return
    }

    if (editingSectionPos !== null) {
      bodyEditorRef.current?.updateSection(editingSectionPos, title)
    } else {
      bodyEditorRef.current?.insertSection(title)
    }

    setSectionDialogOpen(false)
    setEditingSectionPos(null)
  }
}

function Field({ children, className = '', label }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

interface RefFieldProps {
  accept: string
  capture?: boolean
  className?: string
  label: string
  onUpload: (file: File) => Promise<void>
  onValueChange: (value: string) => void
  slug: string
  value: string
}

function RefField({
  accept,
  capture = false,
  className = '',
  label,
  onUpload,
  onValueChange,
  slug,
  value,
}: RefFieldProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)
  const uploadDisabled = !slug.trim() || uploading

  async function uploadFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      await onUpload(file)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    await uploadFile(file)
  }

  function openCamera() {
    if (uploadDisabled) {
      return
    }
    if (isCameraCaptureSupported()) {
      setCameraOpen(true)
      return
    }
    cameraFallbackRef.current?.click()
  }

  const previewUrl = isRefFile(value) ? resolveRefDisplay(value) : value

  return (
    <Field className={className} label={label}>
      <input
        className={inputClassName}
        onChange={event => onValueChange(event.target.value)}
        placeholder="https://example.com/photo.jpg or sources/slug/image.jpg"
        value={isRefFile(value) ? '' : value}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 dark:border-stone-600 dark:text-stone-200">
          <input
            accept={accept}
            className="hidden"
            disabled={uploadDisabled}
            onChange={handleFileChange}
            type="file"
          />
          {uploading ? 'Uploading...' : 'Attach file'}
        </label>
        {capture ? (
          <>
            <input
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              ref={cameraFallbackRef}
              type="file"
            />
            <button
              className="inline-flex items-center rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 disabled:opacity-60 dark:border-stone-600 dark:text-stone-200"
              disabled={uploadDisabled}
              onClick={openCamera}
              type="button"
            >
              Take photo
            </button>
          </>
        ) : null}
      </div>
      <CameraCaptureDialog
        onCapture={file => {
          setCameraOpen(false)
          void uploadFile(file)
        }}
        onClose={() => setCameraOpen(false)}
        open={cameraOpen}
        title={`Photograph ${label.toLowerCase()}`}
      />
      {isRefFile(value) ? (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          File: <a href={resolveRefDisplay(value)}>{value}</a>
        </p>
      ) : null}
      {previewUrl && (isRefFile(value) || value.startsWith('http')) && accept.includes('image') ? (
        <img
          alt=""
          className="mt-3 max-h-40 rounded-xl object-cover"
          src={previewUrl}
        />
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </Field>
  )
}

function isRefFile(value: string): boolean {
  return value.trim().startsWith('sources/')
}

function resolveRefDisplay(value: string): string {
  if (isRefFile(value)) {
    return `/api/sources/${value.slice('sources/'.length)}`
  }
  return value
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

function renderDocument(metadata: Record<string, unknown>, body: string) {
  const lines = Object.entries(metadata)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== '' && !isEmptyArray(value)
    )
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
  if (yamlScalarNeedsQuotes(value)) {
    return JSON.stringify(value)
  }
  return value
}

function yamlScalarNeedsQuotes(value: string): boolean {
  if (!value) {
    return true
  }
  if (/[:#"'[\]{}>&*!|@%`]/.test(value)) {
    return true
  }
  if (/^\s|\s$/.test(value)) {
    return true
  }
  if (/[\n\r\t]/.test(value)) {
    return true
  }
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) {
    return true
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return true
  }
  return false
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
    return value
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
  }
  return []
}

function isEmptyArray(value: unknown) {
  return Array.isArray(value) && value.length === 0
}

function unitSystemEntryLabel(unitSystem: UnitSystem): string {
  if (unitSystem === 'us') {
    return 'cup measures'
  }
  if (unitSystem === 'us_weight') {
    return 'lb/oz'
  }
  return 'metric units (g/kg)'
}
