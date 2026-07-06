import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
  createRecipe,
  getIngredientCatalog,
  importRecipe,
  updateRecipe,
  upsertIngredient,
} from './api'
import { useAuth } from './AuthContext'
import { Autocomplete } from './components/Autocomplete'
import { Button } from './components/Button'
import { Dialog } from './components/Dialog'
import { DensitySearchLink } from './components/DensitySearchLink'
import { ImportingDialog } from './components/ImportingDialog'
import { RecipeBodyEditor, type RecipeBodyEditorHandle } from './components/RecipeBodyEditor'
import { TabPanel, Tabs } from './components/Tabs'
import { TagMultiSelect } from './components/TagMultiSelect'
import { VolumeQuantitySelect } from './components/VolumeQuantitySelect'
import {
  extractTokens,
  INGREDIENT_TOKEN_RE,
  serializeIngredient,
  type IngredientAttrs,
  type IngredientToken,
} from './cooklangTokens'
import { getLocalTags, putIngredientCatalog } from './db'
import { useIngredientCatalog } from './IngredientCatalogContext'
import { parseQuantity } from './quantities'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { buildLoginUrl } from './shareImport'
import { loadRecipeStaleFirst, storeRecipe } from './sync'
import type { CatalogIngredient, UnitSystem } from './types'
import {
  defaultEditorUnit,
  densityForName,
  editorUnitItems,
  findCatalogIngredient,
  formatGramsValue,
  formatIngredientAmount,
  isMassUnit,
  isUsCookingVolumeUnit,
  isVolumeUnit,
  matchCatalogIngredient,
  normalizeUnit,
  toGrams,
} from './units'
import { useUnitSystem } from './UnitSystemContext'

const emptyBody = 'Add @ingredient{100%g}.\n'

interface RecipeEditPageProps {
  mode: 'edit' | 'new'
}

interface MappingRow {
  catalogName: string
  createDensity: string
  fixed: boolean
  note: string
  originalName: string
  quantity: string
  unit: string
}

interface PendingImport {
  body: string
  metadata: Record<string, unknown>
  preserveBookmarked?: boolean
  preserveTags?: boolean
  suggestedSlug?: string
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
  const [ingredientName, setIngredientName] = useState('')
  const [ingredientNote, setIngredientNote] = useState('')
  const [ingredientQuantity, setIngredientQuantity] = useState('')
  const [ingredientUnit, setIngredientUnit] = useState('')
  const [ingredientFixed, setIngredientFixed] = useState(false)
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

  const selectedDensity = densityForName(ingredientName, catalog)
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
    () => mappingRows.every(row => isMappingRowValid(row, catalog)),
    [mappingRows, catalog],
  )

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
      addRecentRecipe(recipe)
      if (!isNew && slug !== recipe.slug) {
        queryClient.removeQueries({ queryKey: ['recipe', slug] })
      }
      navigate(`/recipes/${recipe.slug}`, { replace: true })
    },
  })
  const importMutation = useMutation({
    mutationFn: (url: string) => importRecipe(url),
    onSuccess: preview => {
      const parsed = parseImportedDocument(preview.content)
      openMapping(parsed.metadata, parsed.body, { suggestedSlug: preview.suggested_slug })
      setImportUrl('')
    },
  })
  const reimportMutation = useMutation({
    mutationFn: (url: string) => importRecipe(url),
    onSuccess: preview => {
      const parsed = parseImportedDocument(preview.content)
      openMapping(parsed.metadata, parsed.body, {
        preserveBookmarked: true,
        preserveTags: true,
      })
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

  const handleEditIngredient = useCallback(
    (pos: number, attrs: IngredientAttrs) => {
      const density = densityForName(attrs.name, catalog)
      const display = formatIngredientAmount(attrs.quantity || null, attrs.unit || null, {
        densityKgM3: density,
        unitSystem,
      })
      setEditingPos(pos)
      setIngredientName(attrs.name)
      setIngredientNote(attrs.note)
      setIngredientQuantity(display.quantity || attrs.quantity)
      setIngredientUnit(normalizeUnit(display.unit) ?? '')
      setIngredientFixed(attrs.fixed)
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
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <p className="mt-2 text-stone-600">Editor access is required to change recipe files.</p>
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
                <input
                  className={inputClassName}
                  onChange={event => setTitle(event.target.value)}
                  value={title}
                />
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
                <input
                  className={inputClassName}
                  onChange={event => setTime(event.target.value)}
                  value={time}
                />
              </Field>
              <Field label="Image URL">
                <input
                  className={inputClassName}
                  onChange={event => setImage(event.target.value)}
                  value={image}
                />
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
            {isUsCookingVolumeUnit(ingredientUnit) ? (
              <VolumeQuantitySelect
                onChange={setIngredientQuantity}
                value={ingredientQuantity}
              />
            ) : (
              <input
                className={inputClassName}
                onChange={event => setIngredientQuantity(event.target.value)}
                placeholder="1"
                value={ingredientQuantity}
              />
            )}
          </Field>
          <Field label="Unit">
            <Autocomplete
              allowCustom={false}
              allowEmpty
              onChange={setIngredientUnit}
              options={unitOptions}
              placeholder="optional"
              value={ingredientUnit}
            />
          </Field>
          <Field label="Ingredient">
            <Autocomplete
              onChange={setIngredientName}
              options={ingredientOptions}
              placeholder="flour"
              value={ingredientName}
            />
          </Field>
        </div>
        <Field className="mt-4" label="Details">
          <input
            className={inputClassName}
            onChange={event => setIngredientNote(event.target.value)}
            placeholder="large, bittersweet, unsalted…"
            value={ingredientNote}
          />
        </Field>
        <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-stone-700">
          <input
            checked={ingredientFixed}
            className="h-4 w-4 accent-orange-600"
            onChange={event => setIngredientFixed(event.target.checked)}
            type="checkbox"
          />
          Fixed amount (does not scale)
        </label>
        <p className="mt-2 text-xs text-stone-500">
          Amounts are entered in {unitSystemEntryLabel(unitSystem)} and stored as grams when
          convertible.
          {unitSystem === 'us' && selectedDensity == null
            ? ' No density on this ingredient — volume units are stored as-is (not grams).'
            : null}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setIngredientDialogOpen(false)} variant="ghost">
            Cancel
          </Button>
          <Button disabled={!ingredientName.trim()} onClick={saveIngredientToken}>
            {editingPos !== null ? 'Update ingredient' : 'Add ingredient'}
          </Button>
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

      <Dialog labelledBy="import-mapping-title" open={mappingOpen}>
        <h2 className="text-xl font-bold" id="import-mapping-title">
          Map imported ingredients
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          Ingredients not in your catalog are highlighted and will be created on apply. Match others
          to existing entries; extra wording is saved as details.
        </p>
        <div className="mt-4 max-h-96 space-y-4 overflow-y-auto">
          {mappingRows.map((row, index) => {
            const needsCreate = mappingRowNeedsCreate(row, catalog)
            const densityRequired = mappingRowNeedsDensity(row, catalog)
            const densityInvalid = densityRequired && !mappingRowDensityValid(row)
            return (
              <div
                className={`rounded-2xl p-3 ${
                  needsCreate
                    ? 'bg-amber-100 ring-1 ring-amber-300'
                    : 'bg-orange-50 ring-1 ring-orange-100'
                }`}
                key={`${row.originalName}-${index}`}
              >
                <p className="text-sm font-semibold text-stone-800">
                  {row.quantity}
                  {row.unit ? ` ${row.unit}` : ''} {row.originalName}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-semibold text-stone-700">Ingredient</span>
                    <div className="mt-1">
                      <Autocomplete
                        onChange={catalogName => updateMappingRow(index, { catalogName })}
                        options={ingredientOptions}
                        placeholder="Search or enter name"
                        value={row.catalogName}
                      />
                    </div>
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-stone-700">Details</span>
                    <input
                      className={`${inputClassName} mt-1`}
                      onChange={event => updateMappingRow(index, { note: event.target.value })}
                      placeholder="large, bittersweet, unsalted…"
                      value={row.note}
                    />
                  </label>
                </div>
                {needsCreate ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-sm font-semibold text-amber-900">Create new ingredient</p>
                      <p className="mt-1 text-xs text-stone-600">
                        Provide density for volume conversions between US and metric.
                      </p>
                    </div>
                    <label className="block text-sm">
                      <span className="font-semibold text-stone-700">
                        Density (kg/m³){densityRequired ? ' *' : ''}
                      </span>
                      <div className="mt-1 flex items-center gap-1">
                        <input
                          className={`${inputClassName} min-w-0 flex-1${densityInvalid ? ' border-red-400 ring-red-400' : ''}`}
                          onChange={event =>
                            updateMappingRow(index, { createDensity: event.target.value })
                          }
                          placeholder={densityRequired ? 'Required for cup measures' : 'Optional'}
                          value={row.createDensity}
                        />
                        <DensitySearchLink ingredientName={row.catalogName} />
                      </div>
                    </label>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        {!mappingCanApply ? (
          <p className="mt-3 text-sm text-red-700">
            Enter an ingredient name for each row. New ingredients with volume measures (cups, ml, L, etc.) need a
            density.
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setMappingOpen(false)} variant="ghost">
            Cancel
          </Button>
          <Button disabled={!mappingCanApply} onClick={() => void applyMapping()}>
            Apply mapping
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

  function openMapping(
    metadata: Record<string, unknown>,
    nextBody: string,
    options: Omit<PendingImport, 'body' | 'metadata'> = {}
  ) {
    const tokens = extractTokens(nextBody)
    const unique = new Map<string, IngredientToken>()
    for (const token of tokens) {
      const key = `${token.name.toLowerCase()}|${token.unit.toLowerCase()}`
      if (!unique.has(key)) {
        unique.set(key, token)
      }
    }
    const rows: MappingRow[] = [...unique.values()].map(token => {
      const match = matchCatalogIngredient(token.name, catalog)
      return {
        catalogName: match.catalog?.name ?? token.name,
        createDensity: '',
        fixed: token.fixed,
        note: mergeImportNotes(match.note, token.note),
        originalName: token.name,
        quantity: token.quantity,
        unit: normalizeUnit(token.unit) ?? token.unit,
      }
    })
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

    const created: CatalogIngredient[] = []
    for (const row of mappingRows) {
      if (!mappingRowNeedsCreate(row, catalog) || !row.catalogName.trim()) {
        continue
      }
      const densityValue = row.createDensity.trim()
      const density = densityValue ? Number(densityValue) : null
      if (densityValue && Number.isNaN(density)) {
        continue
      }
      const ingredient = await upsertIngredient({
        aliases:
          row.originalName.toLowerCase() === row.catalogName.trim().toLowerCase()
            ? []
            : [row.originalName],
        density_kg_m3: density,
        name: row.catalogName.trim(),
      })
      created.push(ingredient)
    }

    let workingCatalog = catalog
    if (created.length) {
      const nextCatalog = await getIngredientCatalog()
      await putIngredientCatalog(nextCatalog)
      queryClient.setQueryData(['ingredients'], nextCatalog)
      await refreshCatalog()
      workingCatalog = nextCatalog.ingredients
    }

    const lookup = new Map<string, MappingRow>()
    for (const row of mappingRows) {
      lookup.set(row.originalName.toLowerCase(), row)
    }

    const nextBody = pendingImport.body.replace(
      INGREDIENT_TOKEN_RE,
      (full, bracedName, _amount, bareName) => {
        const name = (bracedName || bareName || '').trim()
        if (!name) {
          return full
        }
        const row = lookup.get(name.toLowerCase())
        if (!row) {
          return full
        }
        return buildMappedIngredientMarker(row, workingCatalog)
      },
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
    setEditingPos(null)
    setIngredientName('')
    setIngredientNote('')
    setIngredientQuantity('1')
    setIngredientUnit(defaultEditorUnit(unitSystem))
    setIngredientFixed(false)
    setIngredientDialogOpen(true)
  }

  function saveIngredientToken() {
    const name = ingredientName.trim()
    if (!name) {
      return
    }

    const quantityText = ingredientQuantity.trim()
    const unit = ingredientUnit.trim()
    const note = ingredientNote.trim()
    let attrs: IngredientAttrs

    if (!quantityText) {
      attrs = { fixed: ingredientFixed, name, note, quantity: '', unit: '' }
    } else if (!unit) {
      attrs = { fixed: ingredientFixed, name, note, quantity: quantityText, unit: '' }
    } else {
      const quantity = parseQuantity(quantityText)
      const density = densityForName(name, catalog)
      const grams = quantity === null ? null : toGrams(quantity, unit, density)
      if (grams == null) {
        attrs = {
          fixed: ingredientFixed,
          name,
          note,
          quantity: quantityText,
          unit: normalizeUnit(unit) ?? unit,
        }
      } else {
        attrs = {
          fixed: ingredientFixed,
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

    setIngredientDialogOpen(false)
    setEditingPos(null)
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

function parseScalar(value: string) {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  const numeric = Number(value)
  return Number.isNaN(numeric) ? value : numeric
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

function mappingRowNeedsCreate(row: MappingRow, ingredients: CatalogIngredient[]): boolean {
  const name = row.catalogName.trim()
  if (!name) {
    return true
  }
  return !findCatalogIngredient(name, ingredients)
}

function mappingRowNeedsDensity(row: MappingRow, ingredients: CatalogIngredient[]): boolean {
  return mappingRowNeedsCreate(row, ingredients) && isVolumeUnit(row.unit)
}

function mappingRowDensityValid(row: MappingRow): boolean {
  const density = Number(row.createDensity.trim())
  return row.createDensity.trim() !== '' && !Number.isNaN(density) && density > 0
}

function isMappingRowValid(row: MappingRow, ingredients: CatalogIngredient[]): boolean {
  if (!row.catalogName.trim()) {
    return false
  }
  if (mappingRowNeedsDensity(row, ingredients) && !mappingRowDensityValid(row)) {
    return false
  }
  return true
}

function mergeImportNotes(...parts: Array<string | null | undefined>): string {
  return parts
    .map(part => part?.trim())
    .filter(Boolean)
    .join(', ')
}

function buildMappedIngredientMarker(
  row: MappingRow,
  catalog: CatalogIngredient[],
): string {
  const targetName = row.catalogName.trim() || row.originalName
  const catalogItem = findCatalogIngredient(targetName, catalog)
  const density = catalogItem?.density_kg_m3
  let quantity = row.quantity
  let unit = row.unit

  const parsed = parseQuantity(row.quantity)
  if (parsed !== null && row.unit) {
    let grams: number | null = null
    if (isMassUnit(row.unit)) {
      grams = toGrams(parsed, row.unit)
    } else if (isVolumeUnit(row.unit)) {
      grams = toGrams(parsed, row.unit, density)
    }
    if (grams !== null) {
      quantity = formatGramsValue(grams)
      unit = 'g'
    } else {
      unit = normalizeUnit(row.unit) ?? row.unit
    }
  }

  return serializeIngredient({
    fixed: row.fixed,
    name: targetName,
    note: row.note,
    quantity,
    unit,
  })
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
