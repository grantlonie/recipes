import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isEqual } from 'lodash-es'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
  createRecipe,
  importRecipe,
  importRecipeFile,
  updateRecipe,
  uploadRecipeImage,
} from './api'
import { useAuth } from './AuthContext'
import { Autocomplete } from './components/Autocomplete'
import { Button } from './components/Button'
import { CameraCaptureDialog, isCameraCaptureSupported } from './components/CameraCaptureDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Dialog } from './components/Dialog'
import { ImportingDialog } from './components/ImportingDialog'
import { ImportMappingDialog } from './components/ImportMappingDialog'
import { RecipeBodyEditor, type RecipeBodyEditorHandle } from './components/RecipeBodyEditor'
import { TabPanel, Tabs } from './components/Tabs'
import { TagMultiSelect } from './components/TagMultiSelect'
import { VolumeQuantitySelect } from './components/VolumeQuantitySelect'
import type { CookwareAttrs } from './cooklangCookware'
import { timerUnitSelectValue, type TimerAttrs, type TimerUnit } from './cooklangTimers'
import type { IngredientAttrs } from './cooklangTokens'
import { deleteRecipes, getLocalRecipe, getLocalTags } from './db'
import {
  applyImportMapping,
  buildMappingRows,
  mappingRowsAreValid,
  mergePreservedImage,
  parseImportedDocument,
  type MappingRow,
  type PendingImport,
} from './importMapping'
import { scheduleMappingDensityAutofill } from './importRecipeFlow'
import { useIngredientCatalog } from './IngredientCatalogContext'
import { parseQuantity } from './quantities'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { buildLoginUrl, ensureUniqueSlug, slugify } from './shareImport'
import { loadRecipeStaleFirst, storeRecipe } from './sync'
import { cardClassName, errorTextClassName, inputClassName } from './themeClasses'
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

interface TimerFormState {
  name: string
  quantity: string
  unit: TimerUnit
}

interface CookwareFormState {
  name: string
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
  const [ingredientInitial, setIngredientInitial] =
    useState<IngredientFormState>(emptyIngredientForm)
  const [ingredientDraft, setIngredientDraft] = useState<IngredientFormState>(emptyIngredientForm)
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false)
  const [editingSectionPos, setEditingSectionPos] = useState<number | null>(null)
  const [sectionTitle, setSectionTitle] = useState('')
  const [timerDialogOpen, setTimerDialogOpen] = useState(false)
  const [editingTimerPos, setEditingTimerPos] = useState<number | null>(null)
  const [timerInitial, setTimerInitial] = useState<TimerFormState>(emptyTimerForm)
  const [timerDraft, setTimerDraft] = useState<TimerFormState>(emptyTimerForm)
  const [cookwareDialogOpen, setCookwareDialogOpen] = useState(false)
  const [editingCookwarePos, setEditingCookwarePos] = useState<number | null>(null)
  const [cookwareInitial, setCookwareInitial] = useState<CookwareFormState>(emptyCookwareForm)
  const [cookwareDraft, setCookwareDraft] = useState<CookwareFormState>(emptyCookwareForm)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([])
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [reimportConfirmOpen, setReimportConfirmOpen] = useState(false)
  const [recipeSlug, setRecipeSlug] = useState(mode === 'new' ? 'new-recipe' : slug)
  const [servings, setServings] = useState(4)
  const [source, setSource] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [time, setTime] = useState('')
  const [prepTime, setPrepTime] = useState('')
  const [cookTime, setCookTime] = useState('')
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
    [catalog]
  )
  const mappingCanApply = useMemo(
    () => mappingRowsAreValid(mappingRows, catalog),
    [mappingRows, catalog]
  )
  const ingredientDirty = editingPos !== null && !isEqual(ingredientInitial, ingredientDraft)
  const timerDirty = editingTimerPos !== null && !isEqual(timerInitial, timerDraft)
  const cookwareDirty = editingCookwarePos !== null && !isEqual(cookwareInitial, cookwareDraft)

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
        preserveImage: true,
        preserveSource: true,
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
    [catalog, unitSystem]
  )

  const handleEditSection = useCallback((pos: number, title: string) => {
    setEditingSectionPos(pos)
    setSectionTitle(title)
    setSectionDialogOpen(true)
  }, [])

  const handleEditTimer = useCallback((pos: number, attrs: TimerAttrs) => {
    const snapshot = timerFormFromAttrs(attrs)
    setEditingTimerPos(pos)
    setTimerInitial(snapshot)
    setTimerDraft(snapshot)
    setTimerDialogOpen(true)
  }, [])

  const handleEditCookware = useCallback((pos: number, attrs: CookwareAttrs) => {
    const snapshot = cookwareFormFromAttrs(attrs)
    setEditingCookwarePos(pos)
    setCookwareInitial(snapshot)
    setCookwareDraft(snapshot)
    setCookwareDialogOpen(true)
  }, [])

  if (!auth.authenticated) {
    return (
      <section className={`mx-auto max-w-md ${cardClassName}`}>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Sign in required</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          Editor access is required to change recipe files.
        </p>
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
    return (
      <p className={`rounded-2xl p-6 text-stone-600 dark:text-stone-400 ${cardClassName}`}>
        Loading recipe...
      </p>
    )
  }

  if (!isNew && !recipeQuery.data) {
    return (
      <p className={`rounded-2xl p-6 text-stone-600 dark:text-stone-400 ${cardClassName}`}>
        Recipe not found.
      </p>
    )
  }

  return (
    <section className="space-y-6">
      <div className={`${cardClassName} p-3! sm:p-6!`}>
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
              <Field label="Prep time">
                <input
                  className={inputClassName}
                  onChange={event => setPrepTime(event.target.value)}
                  placeholder="20 minutes"
                  value={prepTime}
                />
              </Field>
              <Field label="Cook time">
                <input
                  className={inputClassName}
                  onChange={event => setCookTime(event.target.value)}
                  placeholder="1 hour 30 minutes"
                  value={cookTime}
                />
              </Field>
              {!prepTime.trim() && !cookTime.trim() ? (
                <Field label="Time">
                  <input
                    className={inputClassName}
                    onChange={event => setTime(event.target.value)}
                    placeholder="1 hour"
                    value={time}
                  />
                </Field>
              ) : null}
              <ImageField
                className="lg:col-span-2"
                onUpload={handleImageUpload}
                onValueChange={setImage}
                slug={isNew ? recipeSlug : slug}
                value={image}
              />
              {!isNew && reimportMutation.error ? (
                <p className={`lg:col-span-2 text-sm ${errorTextClassName}`}>
                  {reimportMutation.error.message}
                </p>
              ) : null}
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
            <div className="mb-3 flex items-center justify-end gap-2">
              <div
                className="inline-flex overflow-hidden rounded-full bg-orange-100 text-xs font-semibold text-orange-800 ring-1 ring-orange-200 dark:bg-stone-700 dark:text-orange-200 dark:ring-stone-600"
                role="group"
              >
                <InsertSegmentButton first onClick={openAddIngredient}>
                  ingredient
                </InsertSegmentButton>
                <InsertSegmentButton onClick={openAddNote}>note</InsertSegmentButton>
                <InsertSegmentButton onClick={openAddTimer}>time</InsertSegmentButton>
                <InsertSegmentButton onClick={openAddSection}>header</InsertSegmentButton>
                <InsertSegmentButton onClick={openAddCookware}>cookware</InsertSegmentButton>
              </div>
            </div>
            <RecipeBodyEditor
              catalog={catalog}
              onChange={setBody}
              onEditCookware={handleEditCookware}
              onEditIngredient={handleEditIngredient}
              onEditSection={handleEditSection}
              onEditTimer={handleEditTimer}
              ref={bodyEditorRef}
              unitSystem={unitSystem}
              value={body}
            />
          </TabPanel>
        </div>
        {saveMutation.error ? (
          <p className={`mt-2 text-sm ${errorTextClassName}`}>{saveMutation.error.message}</p>
        ) : null}
      </div>

      <ImportingDialog open={importMutation.isPending || reimportMutation.isPending} />

      <ConfirmDialog
        confirmLabel="Re-import"
        confirming={reimportMutation.isPending}
        confirmingLabel="Re-importing..."
        description={
          isRefFile(source)
            ? 'Re-importing will overwrite the current recipe title, metadata, and body from the source file.'
            : 'Re-importing will overwrite the current recipe title, metadata, and body from the source URL.'
        }
        labelledBy="reimport-confirm-title"
        onCancel={() => setReimportConfirmOpen(false)}
        onConfirm={() => void confirmReimportFromSource()}
        open={reimportConfirmOpen}
        title="Re-import recipe?"
      />

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

      <Dialog labelledBy="timer-dialog-title" open={timerDialogOpen}>
        <h2 className="text-xl font-bold" id="timer-dialog-title">
          {editingTimerPos !== null ? 'Edit time' : 'Add time'}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Amount">
            <input
              autoFocus
              className={inputClassName}
              inputMode="decimal"
              min="0"
              onChange={event =>
                setTimerDraft(current => ({ ...current, quantity: event.target.value }))
              }
              placeholder="15"
              step="any"
              type="number"
              value={timerDraft.quantity}
            />
          </Field>
          <Field label="Unit">
            <select
              className={inputClassName}
              onChange={event =>
                setTimerDraft(current => ({
                  ...current,
                  unit: event.target.value as TimerUnit,
                }))
              }
              value={timerDraft.unit}
            >
              <option value="minutes">min</option>
              <option value="hours">hour</option>
            </select>
          </Field>
        </div>
        <div className="mt-6 flex justify-between gap-2">
          {editingTimerPos !== null ? (
            <Button onClick={deleteTimerToken} variant="danger">
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {editingTimerPos === null || timerDirty ? (
              <Button onClick={closeTimerDialog} variant="ghost">
                Cancel
              </Button>
            ) : null}
            <Button
              className={editingTimerPos !== null ? 'w-[80px] justify-center' : undefined}
              disabled={!timerDraft.quantity.trim()}
              onClick={confirmTimerDialog}
            >
              {editingTimerPos !== null ? (timerDirty ? 'Update' : 'Done') : 'Add time'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog labelledBy="cookware-dialog-title" open={cookwareDialogOpen}>
        <h2 className="text-xl font-bold" id="cookware-dialog-title">
          {editingCookwarePos !== null ? 'Edit cookware' : 'Add cookware'}
        </h2>
        <Field className="mt-4" label="Cookware">
          <input
            autoFocus
            className={inputClassName}
            onChange={event =>
              setCookwareDraft(current => ({ ...current, name: event.target.value }))
            }
            placeholder="large bowl, skillet, baking sheet…"
            value={cookwareDraft.name}
          />
        </Field>
        <div className="mt-6 flex justify-between gap-2">
          {editingCookwarePos !== null ? (
            <Button onClick={deleteCookwareToken} variant="danger">
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {editingCookwarePos === null || cookwareDirty ? (
              <Button onClick={closeCookwareDialog} variant="ghost">
                Cancel
              </Button>
            ) : null}
            <Button
              className={editingCookwarePos !== null ? 'w-[80px] justify-center' : undefined}
              disabled={!cookwareDraft.name.trim()}
              onClick={confirmCookwareDialog}
            >
              {editingCookwarePos !== null ? (cookwareDirty ? 'Update' : 'Done') : 'Add cookware'}
            </Button>
          </div>
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
          <p className={`mt-2 text-sm ${errorTextClassName}`}>{importMutation.error.message}</p>
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
    const nextPrep = getString(metadata['prep time']) || getString(metadata['time.prep']) || ''
    const nextCook = getString(metadata['cook time']) || getString(metadata['time.cook']) || ''
    setPrepTime(nextPrep)
    setCookTime(nextCook)
    setTime(
      nextPrep || nextCook ? '' : getString(metadata.time) || getString(metadata.duration) || ''
    )
    setDescription(
      cleanNoteText(getString(metadata.description) || getString(metadata.introduction))
    )
    setBookmarked(getBoolean(metadata.bookmarked))
    setBody(nextBody || emptyBody)
  }

  function buildContent() {
    const nextPrep = prepTime.trim()
    const nextCook = cookTime.trim()
    const nextTotal = time.trim()
    const metadata: Record<string, unknown> = {
      ...baseMetadata,
      bookmarked,
      description: description.trim() || undefined,
      image: image.trim() || undefined,
      servings,
      source: source.trim() || undefined,
      tags,
      title: title.trim() || 'Untitled Recipe',
    }
    delete metadata.duration
    delete metadata['time.prep']
    delete metadata['time.cook']
    if (nextPrep || nextCook) {
      metadata['prep time'] = nextPrep || undefined
      metadata['cook time'] = nextCook || undefined
      delete metadata.time
    } else {
      delete metadata['prep time']
      delete metadata['cook time']
      metadata.time = nextTotal || undefined
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

  function handleReimportFromSource() {
    if (!source.trim()) {
      return
    }
    setReimportConfirmOpen(true)
  }

  async function confirmReimportFromSource() {
    setReimportConfirmOpen(false)
    await reimportMutation.mutateAsync()
  }

  async function handleImageUpload(file: File) {
    const path = await uploadRecipeImage(recipeSlug, file)
    setImage(path)
  }

  function handleImportPreview(
    preview: ImportPreview,
    options: Omit<PendingImport, 'body' | 'metadata'> = {}
  ) {
    const parsed = parseImportedDocument(preview.content)
    const unmatched = preview.unmatched_ingredients ?? []
    const importedImage =
      preview.image_url?.trim() ||
      getString(parsed.metadata.image) ||
      getString(parsed.metadata.picture)
    let metadata = options.preserveImage
      ? withPreservedImage(parsed.metadata, image, importedImage)
      : withImportedImage(parsed.metadata, importedImage)
    if (options.preserveSource) {
      metadata = { ...metadata, source: source.trim() || undefined }
    }
    if (unmatched.length === 0) {
      const currentBookmarked = bookmarked
      const currentTags = tags
      const currentSource = source
      applyDocumentState(metadata, parsed.body, { skipTags: Boolean(options.preserveTags) })
      if (options.preserveBookmarked) {
        setBookmarked(currentBookmarked)
      }
      if (options.preserveTags) {
        setTags(currentTags)
      }
      if (options.preserveSource) {
        setSource(currentSource)
      }
      if (options.suggestedSlug) {
        setRecipeSlug(options.suggestedSlug)
      }
      return
    }
    openMapping(metadata, parsed.body, { ...options, unmatchedIngredients: unmatched })
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
    scheduleMappingDensityAutofill(rows, catalog, setMappingRows)
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
      refreshCatalog
    )

    const currentBookmarked = bookmarked
    const currentTags = tags
    const currentSource = source
    applyDocumentState(pendingImport.metadata, nextBody, { skipTags: true })
    if (pendingImport.preserveBookmarked) {
      setBookmarked(currentBookmarked)
    }
    if (pendingImport.preserveTags) {
      setTags(currentTags)
    } else {
      setTags(getTagsFromMetadata(pendingImport.metadata.tags))
    }
    if (pendingImport.preserveSource) {
      setSource(currentSource)
    }
    if (pendingImport.suggestedSlug) {
      setRecipeSlug(pendingImport.suggestedSlug)
    }
    setMappingOpen(false)
    setPendingImport(null)
    setActiveTab('recipe')
  }

  function openAddNote() {
    bodyEditorRef.current?.insertNote()
  }

  function openAddTimer() {
    const snapshot = emptyTimerForm()
    setEditingTimerPos(null)
    setTimerInitial(snapshot)
    setTimerDraft(snapshot)
    setTimerDialogOpen(true)
  }

  function openAddSection() {
    setEditingSectionPos(null)
    setSectionTitle('')
    setSectionDialogOpen(true)
  }

  function openAddCookware() {
    const snapshot = emptyCookwareForm()
    setEditingCookwarePos(null)
    setCookwareInitial(snapshot)
    setCookwareDraft(snapshot)
    setCookwareDialogOpen(true)
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

  function closeTimerDialog() {
    setTimerDialogOpen(false)
    setEditingTimerPos(null)
    const snapshot = emptyTimerForm()
    setTimerInitial(snapshot)
    setTimerDraft(snapshot)
  }

  function confirmTimerDialog() {
    if (editingTimerPos !== null && !timerDirty) {
      closeTimerDialog()
      return
    }
    saveTimerToken()
  }

  function saveTimerToken() {
    const quantity = timerDraft.quantity.trim()
    if (!quantity) {
      return
    }
    const attrs: TimerAttrs = {
      name: timerDraft.name,
      quantity,
      unit: timerDraft.unit,
    }
    if (editingTimerPos !== null) {
      bodyEditorRef.current?.updateTimer(editingTimerPos, attrs)
    } else {
      bodyEditorRef.current?.insertTimer(attrs)
    }
    closeTimerDialog()
  }

  function deleteTimerToken() {
    if (editingTimerPos === null) {
      return
    }
    bodyEditorRef.current?.deleteTimer(editingTimerPos)
    closeTimerDialog()
  }

  function closeCookwareDialog() {
    setCookwareDialogOpen(false)
    setEditingCookwarePos(null)
    const snapshot = emptyCookwareForm()
    setCookwareInitial(snapshot)
    setCookwareDraft(snapshot)
  }

  function confirmCookwareDialog() {
    if (editingCookwarePos !== null && !cookwareDirty) {
      closeCookwareDialog()
      return
    }
    saveCookwareToken()
  }

  function saveCookwareToken() {
    const name = cookwareDraft.name.trim()
    if (!name) {
      return
    }
    const attrs: CookwareAttrs = { name }
    if (editingCookwarePos !== null) {
      bodyEditorRef.current?.updateCookware(editingCookwarePos, attrs)
    } else {
      bodyEditorRef.current?.insertCookware(attrs)
    }
    closeCookwareDialog()
  }

  function deleteCookwareToken() {
    if (editingCookwarePos === null) {
      return
    }
    bodyEditorRef.current?.deleteCookware(editingCookwarePos)
    closeCookwareDialog()
  }
}

interface FieldProps {
  children: ReactNode
  className?: string
  label: string
}

interface InsertSegmentButtonProps {
  children: ReactNode
  first?: boolean
  onClick: () => void
}

function InsertSegmentButton({ children, first = false, onClick }: InsertSegmentButtonProps) {
  return (
    <button
      className={`px-3 py-1.5 transition hover:bg-orange-200 dark:hover:bg-stone-600 ${
        first ? '' : 'border-l border-orange-200 dark:border-stone-600'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function Field({ children, className = '', label }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

interface ImageFieldProps {
  className?: string
  onUpload: (file: File) => Promise<void>
  onValueChange: (value: string) => void
  slug: string
  value: string
}

function ImageField({ className = '', onUpload, onValueChange, slug, value }: ImageFieldProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadDisabled = !slug.trim() || uploading
  const hasFile = isRefFile(value)
  const previewUrl = hasFile
    ? resolveRefDisplay(value)
    : value.startsWith('http')
      ? value
      : ''

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

  function openFilePicker() {
    if (uploadDisabled) {
      return
    }
    fileInputRef.current?.click()
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

  return (
    <div className={`block ${className}`}>
      <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">Image</span>
      <div className="mt-1 space-y-2">
        {previewUrl ? (
          <a
            className="inline-block"
            href={previewUrl}
            rel="noreferrer"
            target="_blank"
          >
            <img alt="" className="max-h-40 rounded-xl object-cover" src={previewUrl} />
          </a>
        ) : null}
        {!hasFile ? (
          <input
            className={inputClassName}
            onChange={event => onValueChange(event.target.value)}
            placeholder="https://example.com/photo.jpg"
            value={value}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={uploadDisabled} onClick={openFilePicker} variant="ghost">
            {uploading ? 'Uploading...' : hasFile || previewUrl ? 'Replace File' : 'Attach file'}
          </Button>
          {hasFile ? (
            <Button onClick={() => onValueChange('')} variant="ghost">
              Use Web
            </Button>
          ) : null}
          <Button disabled={uploadDisabled} onClick={openCamera} variant="ghost">
            Take Photo
          </Button>
        </div>
        <input
          accept="image/*"
          className="hidden"
          disabled={uploadDisabled}
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
        <input
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          ref={cameraFallbackRef}
          type="file"
        />
        <CameraCaptureDialog
          onCapture={file => {
            setCameraOpen(false)
            void uploadFile(file)
          }}
          onClose={() => setCameraOpen(false)}
          open={cameraOpen}
          title="Photograph image"
        />
        {error ? <p className={`text-sm ${errorTextClassName}`}>{error}</p> : null}
      </div>
    </div>
  )
}

function withImportedImage(
  metadata: Record<string, unknown>,
  importedImage: string
): Record<string, unknown> {
  const next = importedImage.trim()
  if (!next) {
    return metadata
  }
  return { ...metadata, image: next }
}

function withPreservedImage(
  metadata: Record<string, unknown>,
  currentImage: string,
  importedImage: string
): Record<string, unknown> {
  const merged = mergePreservedImage(currentImage, importedImage)
  if (!merged) {
    const next = { ...metadata }
    delete next.image
    delete next.picture
    return next
  }
  return { ...metadata, image: merged }
}

function isRefFile(value: string): boolean {
  return value.trim().startsWith('recipes/')
}

function resolveRefDisplay(value: string): string {
  if (isRefFile(value)) {
    return `/api/sources/${value.slice('recipes/'.length)}`
  }
  return value
}

function emptyIngredientForm(): IngredientFormState {
  return { fixed: false, name: '', note: '', qty: '', units: '' }
}

function emptyTimerForm(): TimerFormState {
  return { name: '', quantity: '', unit: 'minutes' }
}

function emptyCookwareForm(): CookwareFormState {
  return { name: '' }
}

function cookwareFormFromAttrs(attrs: CookwareAttrs): CookwareFormState {
  return { name: attrs.name }
}

function timerFormFromAttrs(attrs: TimerAttrs): TimerFormState {
  return {
    name: attrs.name,
    quantity: attrs.quantity,
    unit: timerUnitSelectValue(attrs.unit),
  }
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
  unitSystem: UnitSystem
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

function cleanNoteText(value: string) {
  let text = value.trim()
  while (text.length >= 2 && (text.startsWith('"') || text.startsWith("'")) && text.endsWith('\\')) {
    text = text.slice(1, -1).trimEnd()
  }
  if (
    text.length >= 2 &&
    text[0] === text[text.length - 1] &&
    (text[0] === '"' || text[0] === "'")
  ) {
    const inner = text.slice(1, -1)
    if (text[0] === "'" || !inner.includes('"')) {
      text = inner.trim()
    }
  }
  if (text.startsWith('"') && text.split('"').length === 2) {
    text = text.slice(1)
  }
  if (text.startsWith("'") && text.split("'").length === 2) {
    text = text.slice(1)
  }
  text = text.replace(/\\+$/, '').trim()
  return text
    .replace(/\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (_, short, long) =>
      String.fromCodePoint(Number.parseInt(short || long, 16))
    )
    .trim()
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
