import { useEffect, useMemo, useRef, useState } from 'react'

import { Autocomplete } from './Autocomplete'
import { Button } from './Button'
import { DensitySearchLink } from './DensitySearchLink'
import { Dialog } from './Dialog'
import {
  buildBulkUnmatchedQueue,
  commitBulkMappingRows,
  countBulkProgress,
  createBulkImportItems,
  loadExistingIndex,
  markItemsReadyIgnoringUnmatched,
  runBulkConvertQueue,
  saveBulkImportItem,
  type BulkExistingIndex,
  type BulkImportItem,
  type BulkUnmatchedRow,
} from '../bulkImport'
import {
  isMappingRowValid,
  mappingRowDensityValid,
  mappingRowNeedsCreate,
  mappingRowNeedsDensity,
  type MappingRow,
} from '../importMapping'
import {
  errorTextClassName,
  inputClassName,
  mappingCreateCardClassName,
  mappingCreateTitleClassName,
} from '../themeClasses'
import type { CatalogIngredient } from '../types'

interface BulkImportDialogProps {
  catalog: CatalogIngredient[]
  files: File[]
  onClose: () => void
  onComplete: () => void
  open: boolean
  refreshCatalog: () => Promise<void>
  sync: () => Promise<void>
}

export function BulkImportDialog({
  catalog,
  files,
  onClose,
  onComplete,
  open,
  refreshCatalog,
  sync,
}: BulkImportDialogProps) {
  const [items, setItems] = useState<BulkImportItem[]>([])
  const [queueRows, setQueueRows] = useState<BulkUnmatchedRow[]>([])
  const [converting, setConverting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applyingKey, setApplyingKey] = useState<string | null>(null)
  const [skipExistingBySlug, setSkipExistingBySlug] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const catalogRef = useRef(catalog)
  const itemsRef = useRef(items)
  const activeRef = useRef(true)
  const savingRef = useRef(false)
  const skipExistingBySlugRef = useRef(skipExistingBySlug)
  const existingIndexRef = useRef<BulkExistingIndex | null>(null)
  const usedSlugsRef = useRef(new Set<string>())
  const syncNeededRef = useRef(false)

  useEffect(() => {
    catalogRef.current = catalog
  }, [catalog])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    skipExistingBySlugRef.current = skipExistingBySlug
  }, [skipExistingBySlug])

  useEffect(() => {
    activeRef.current = open
    if (open) {
      existingIndexRef.current = null
      usedSlugsRef.current = new Set()
      syncNeededRef.current = false
    }
    return () => {
      activeRef.current = false
    }
  }, [open])

  useEffect(() => {
    if (!open || files.length === 0) {
      return
    }

    let cancelled = false
    const nextItems = createBulkImportItems(files)
    setItems(nextItems)
    setQueueRows([])
    setError(null)
    setConverting(true)
    activeRef.current = true

    void (async () => {
      try {
        existingIndexRef.current = await loadExistingIndex()
        if (cancelled || !activeRef.current) {
          return
        }
        await runBulkConvertQueue({
          getCatalog: () => catalogRef.current,
          getExisting: () =>
            existingIndexRef.current ?? { bySlug: new Set(), bySourceUrl: new Map() },
          items: nextItems,
          onItemsChange: updater => {
            if (cancelled) {
              return
            }
            setItems(current => updater(current))
          },
          shouldContinue: () => !cancelled && activeRef.current,
          skipExistingBySourceUrl: true,
        })
      } catch (startError) {
        if (!cancelled && activeRef.current) {
          setError(startError instanceof Error ? startError.message : 'Could not start bulk import')
        }
      } finally {
        if (!cancelled && activeRef.current) {
          setConverting(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [files, open])

  useEffect(() => {
    setQueueRows(current => mergeUnmatchedQueue(current, buildBulkUnmatchedQueue(items, catalog)))
  }, [items, catalog])

  useEffect(() => {
    if (!open || savingRef.current) {
      return
    }
    const readyCount = items.filter(item => item.status === 'ready').length
    if (readyCount === 0) {
      return
    }
    void saveReadyRecipes()
  }, [items, open])

  const progress = useMemo(() => countBulkProgress(items), [items])
  const importedCount = progress.converted + progress.skipped + progress.failed
  const progressPercent =
    progress.total === 0 ? 0 : Math.round((importedCount / progress.total) * 100)
  const convertDone = !converting && progress.queued === 0 && progress.converting === 0
  const allSettled =
    convertDone &&
    progress.pendingMapping === 0 &&
    progress.ready === 0 &&
    !saving &&
    progress.saved + progress.skipped + progress.failed === progress.total
  const applying = applyingKey !== null

  function updateQueueRow(index: number, patch: Partial<MappingRow>) {
    setQueueRows(current =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    )
  }

  async function confirmIngredient(row: BulkUnmatchedRow) {
    const rowKey = `${row.originalName.toLowerCase()}|${row.unit.toLowerCase()}`
    if (!isMappingRowValid(row, catalog) || applying) {
      return
    }
    setApplyingKey(rowKey)
    setError(null)
    try {
      const { items: nextItems } = await commitBulkMappingRows(
        itemsRef.current,
        [row],
        catalogRef.current,
        refreshCatalog
      )
      setItems(nextItems)
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Could not confirm ingredient')
    } finally {
      setApplyingKey(null)
    }
  }

  function saveAsIs() {
    setItems(current => markItemsReadyIgnoringUnmatched(current))
  }

  async function saveReadyRecipes() {
    if (savingRef.current) {
      return
    }
    const readyItems = itemsRef.current.filter(item => item.status === 'ready')
    if (!readyItems.length) {
      return
    }

    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      if (!existingIndexRef.current) {
        existingIndexRef.current = await loadExistingIndex()
      }
      const existing = existingIndexRef.current
      const usedSlugs = usedSlugsRef.current

      for (const item of readyItems) {
        if (!activeRef.current) {
          break
        }
        const latest = itemsRef.current.find(entry => entry.id === item.id)
        if (!latest || latest.status !== 'ready') {
          continue
        }
        setItems(current =>
          current.map(entry =>
            entry.id === item.id ? { ...entry, status: 'saving' as const } : entry
          )
        )
        try {
          const saved = await saveBulkImportItem(latest, {
            existing,
            skipExistingBySlug: skipExistingBySlugRef.current,
            usedSlugs,
          })
          syncNeededRef.current = true
          setItems(current => current.map(entry => (entry.id === item.id ? saved : entry)))
        } catch (saveError) {
          const message = saveError instanceof Error ? saveError.message : 'Save failed'
          setItems(current =>
            current.map(entry =>
              entry.id === item.id ? { ...entry, error: message, status: 'failed' as const } : entry
            )
          )
        }
      }
      if (syncNeededRef.current) {
        await sync()
        syncNeededRef.current = false
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save failed')
    } finally {
      savingRef.current = false
      setSaving(false)
      if (activeRef.current && itemsRef.current.some(item => item.status === 'ready')) {
        void saveReadyRecipes()
      }
    }
  }

  async function retryFailed() {
    const failed = items.filter(item => item.status === 'failed')
    if (!failed.length || converting) {
      return
    }
    setConverting(true)
    setError(null)
    const toRetry = failed.map(item => ({
      ...item,
      error: undefined,
      status: 'queued' as const,
    }))
    const retryIds = new Set(toRetry.map(item => item.id))
    setItems(current =>
      current.map(item =>
        retryIds.has(item.id) ? { ...item, error: undefined, status: 'queued' as const } : item
      )
    )

    void runBulkConvertQueue({
      getCatalog: () => catalogRef.current,
      getExisting: () => existingIndexRef.current ?? { bySlug: new Set(), bySourceUrl: new Map() },
      items: toRetry,
      onItemsChange: updater => {
        setItems(current => {
          const retrySlice = current.filter(entry => retryIds.has(entry.id))
          const updatedSlice = updater(retrySlice)
          const byId = new Map(updatedSlice.map(entry => [entry.id, entry]))
          return current.map(entry => byId.get(entry.id) ?? entry)
        })
      },
      shouldContinue: () => activeRef.current,
      skipExistingBySourceUrl: true,
    }).finally(() => {
      if (activeRef.current) {
        setConverting(false)
      }
    })
  }

  function handleClose() {
    if (converting || saving || applying) {
      activeRef.current = false
    }
    onClose()
  }

  function handleDone() {
    onComplete()
  }

  return (
    <Dialog className="max-w-3xl" labelledBy="bulk-import-title" open={open}>
      <h2 className="text-xl font-bold" id="bulk-import-title">
        Import files
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Recipes import in the background. Confirm each unknown ingredient as it appears — Done saves
        it to your catalog and updates matching recipes.
      </p>

      <div className="mt-5">
        <div className="flex items-end justify-between gap-3 text-sm">
          <p className="font-semibold text-stone-800 dark:text-stone-100">
            {importedCount} of {progress.total} recipes imported
          </p>
          <p className="text-stone-500 dark:text-stone-400">
            {progress.saved} saved
            {progress.skipped > 0 ? ` · ${progress.skipped} skipped` : ''}
            {progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
          </p>
        </div>
        <div
          aria-label="Import progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progressPercent}
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-orange-600 transition-[width] duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {progress.converting > 0 || progress.pendingMapping > 0 ? (
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            {progress.converting > 0 ? `${progress.converting} converting` : null}
            {progress.converting > 0 && progress.pendingMapping > 0 ? ' · ' : null}
            {progress.pendingMapping > 0
              ? `${progress.pendingMapping} waiting on ingredient mapping`
              : null}
          </p>
        ) : null}
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
        <input
          checked={skipExistingBySlug}
          onChange={event => setSkipExistingBySlug(event.target.checked)}
          type="checkbox"
        />
        Also skip when the suggested slug already exists
      </label>

      {error ? <p className={`mt-3 text-sm ${errorTextClassName}`}>{error}</p> : null}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">
          Ingredients to confirm ({queueRows.length})
        </h3>

        {queueRows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            {converting
              ? 'Waiting for converted recipes…'
              : progress.pendingMapping === 0
                ? 'No unmatched ingredients left.'
                : 'No mapping rows to show.'}
          </p>
        ) : (
          <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
            {queueRows.map((row, index) => {
              const rowKey = `${row.originalName.toLowerCase()}|${row.unit.toLowerCase()}`
              return (
                <BulkMappingRowCard
                  applying={applyingKey === rowKey}
                  catalog={catalog}
                  disabled={applying && applyingKey !== rowKey}
                  key={`${row.originalName}|${row.unit}|${index}`}
                  onDone={() => void confirmIngredient(row)}
                  onUpdate={patch => updateQueueRow(index, patch)}
                  row={row}
                />
              )
            })}
          </div>
        )}
      </div>

      {progress.failed > 0 ? (
        <div className="mt-4 rounded-2xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900">
          <p className="font-semibold">{progress.failed} failed</p>
          <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto">
            {items
              .filter(item => item.status === 'failed')
              .map(item => (
                <li key={item.id}>
                  {item.fileName}
                  {item.error ? ` — ${item.error}` : ''}
                </li>
              ))}
          </ul>
          <Button
            className="mt-3"
            disabled={converting}
            onClick={() => void retryFailed()}
            type="button"
            variant="secondary"
          >
            Retry failed
          </Button>
        </div>
      ) : null}

      {progress.skipped > 0 ? (
        <div className="mt-4 rounded-2xl bg-stone-100 p-3 text-sm text-stone-700 ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-200 dark:ring-stone-700">
          <p className="font-semibold">{progress.skipped} skipped</p>
          <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto">
            {items
              .filter(item => item.status === 'skipped')
              .map(item => (
                <li key={item.id}>
                  {item.fileName}
                  {item.skipReason ? ` — ${item.skipReason}` : ''}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {items.some(item => item.validationWarnings.length > 0) ? (
        <div className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
          <p className="font-semibold">Import validation warnings</p>
          <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
            {items
              .filter(item => item.validationWarnings.length > 0)
              .map(item => (
                <li key={item.id}>
                  <span className="font-medium">{item.suggestedSlug || item.fileName}</span>
                  <ul className="ml-4 list-disc">
                    {item.validationWarnings.map(warning => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button disabled={saving || applying} onClick={handleClose} type="button" variant="ghost">
          {allSettled ? 'Close' : 'Cancel'}
        </Button>
        {progress.pendingMapping > 0 ? (
          <Button disabled={saving || applying} onClick={saveAsIs} type="button" variant="ghost">
            Save remaining as-is
          </Button>
        ) : null}
        {allSettled ? (
          <Button onClick={handleDone} type="button">
            Done
          </Button>
        ) : null}
      </div>
    </Dialog>
  )
}

interface BulkMappingRowCardProps {
  applying: boolean
  catalog: CatalogIngredient[]
  disabled?: boolean
  onDone: () => void
  onUpdate: (patch: Partial<MappingRow>) => void
  row: BulkUnmatchedRow
}

function mergeUnmatchedQueue(
  current: BulkUnmatchedRow[],
  next: BulkUnmatchedRow[]
): BulkUnmatchedRow[] {
  const currentByKey = new Map(
    current.map(row => [`${row.originalName.toLowerCase()}|${row.unit.toLowerCase()}`, row])
  )
  return next.map(row => {
    const key = `${row.originalName.toLowerCase()}|${row.unit.toLowerCase()}`
    const existing = currentByKey.get(key)
    if (!existing) {
      return row
    }
    return {
      ...row,
      catalogName: existing.catalogName,
      createDensity: existing.createDensity,
      excluded: existing.excluded,
      note: existing.note,
    }
  })
}

function BulkMappingRowCard({
  applying,
  catalog,
  disabled = false,
  onDone,
  onUpdate,
  row,
}: BulkMappingRowCardProps) {
  const ingredientOptions = useMemo(
    () =>
      catalog.map(item => ({
        label: item.density_kg_m3 == null ? `${item.name} (weight)` : item.name,
        value: item.name,
      })),
    [catalog]
  )
  const needsCreate = mappingRowNeedsCreate(row, catalog)
  const densityRequired = mappingRowNeedsDensity(row, catalog)
  const densityInvalid = densityRequired && !mappingRowDensityValid(row)
  const canDone = isMappingRowValid(row, catalog)

  return (
    <div
      className={`rounded-2xl p-3 ${
        row.excluded
          ? 'bg-stone-100 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700'
          : needsCreate
            ? mappingCreateCardClassName
            : 'bg-orange-50 ring-1 ring-orange-100 dark:bg-stone-800 dark:ring-stone-700'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
            {row.originalName}
            {row.unit ? (
              <span className="font-normal text-stone-500 dark:text-stone-400"> ({row.unit})</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            In {row.recipeCount} recipe{row.recipeCount === 1 ? '' : 's'}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
          <input
            checked={row.excluded}
            disabled={disabled || applying}
            onChange={event =>
              onUpdate({
                catalogName: event.target.checked ? '' : row.originalName,
                createDensity: event.target.checked ? '' : row.createDensity,
                excluded: event.target.checked,
              })
            }
            type="checkbox"
          />
          Not an ingredient
        </label>
      </div>
      {row.excluded ? (
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          Kept as plain text in recipe steps.
        </p>
      ) : (
        <>
          <label className="mt-3 block text-sm">
            <span className="font-semibold text-stone-700 dark:text-stone-200">Ingredient</span>
            <div className="mt-1">
              <Autocomplete
                onChange={catalogName => onUpdate({ catalogName })}
                options={ingredientOptions}
                placeholder="Search or enter name"
                value={row.catalogName}
              />
            </div>
          </label>
          {needsCreate ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className={`text-sm font-semibold ${mappingCreateTitleClassName}`}>
                  Create new ingredient
                </p>
                <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
                  Density needed for volume conversions.
                </p>
              </div>
              <label className="block text-sm">
                <span className="font-semibold text-stone-700 dark:text-stone-200">
                  Density (kg/m³){densityRequired ? ' *' : ''}
                </span>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    className={`${inputClassName} min-w-0 flex-1${densityInvalid ? ' border-red-400 ring-red-400' : ''}`}
                    disabled={disabled || applying}
                    onChange={event => onUpdate({ createDensity: event.target.value })}
                    placeholder={densityRequired ? 'Required for cup measures' : 'Optional'}
                    value={row.createDensity}
                  />
                  <DensitySearchLink ingredientName={row.catalogName} />
                </div>
              </label>
            </div>
          ) : null}
        </>
      )}
      <div className="mt-3 flex justify-end">
        <Button disabled={!canDone || disabled || applying} onClick={onDone} type="button">
          {applying ? 'Saving…' : 'Done'}
        </Button>
      </div>
    </div>
  )
}
