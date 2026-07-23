import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'

import {
  countBulkProgress,
  createBulkImportItems,
  loadExistingIndex,
  runBulkConvertQueue,
  saveBulkImportItem,
  type BulkExistingIndex,
  type BulkImportItem,
} from './bulkImport'
import { useIngredientCatalog } from './IngredientCatalogContext'
import { useRecipeSync } from './RecipeSyncContext'

export type ImportProgressPhase = 'idle' | 'running' | 'complete' | 'error'

export interface ImportProgressState {
  bulk: boolean
  done: number
  error?: string
  failed: number
  phase: ImportProgressPhase
  saved: number
  skipped: number
  status?: string
  title: string
  total: number
  unmatchedCount: number
}

interface StartImportOptions {
  title?: string
  total: number
}

interface CompleteImportOptions {
  failed?: number
  saved?: number
  skipped?: number
  unmatchedCount?: number
}

interface ImportProgressContextValue {
  completeImport: (options?: CompleteImportOptions) => void
  dismiss: () => void
  failImport: (error: string) => void
  startBulkImport: (files: File[]) => void
  startImport: (options: StartImportOptions) => void
  state: ImportProgressState
  updateProgress: (patch: Partial<ImportProgressState>) => void
}

const idleState: ImportProgressState = {
  bulk: false,
  done: 0,
  failed: 0,
  phase: 'idle',
  saved: 0,
  skipped: 0,
  title: '',
  total: 0,
  unmatchedCount: 0,
}

const ImportProgressContext = createContext<ImportProgressContextValue | null>(null)

const COMPLETE_DISMISS_MS = 3000

export function ImportProgressProvider({ children }: { children: ReactNode }) {
  const { ingredients: catalog } = useIngredientCatalog()
  const { sync, notifyLocalChange } = useRecipeSync()
  const catalogRef = useRef(catalog)
  const activeBulkRef = useRef(false)
  const savingRef = useRef(false)
  const itemsRef = useRef<BulkImportItem[]>([])
  const existingIndexRef = useRef<BulkExistingIndex | null>(null)
  const usedSlugsRef = useRef(new Set<string>())
  const [state, setState] = useState<ImportProgressState>(idleState)
  const [skipExistingBySlug] = useState(true)

  catalogRef.current = catalog

  const dismiss = useCallback(() => {
    activeBulkRef.current = false
    setState(idleState)
  }, [])

  const startImport = useCallback((options: StartImportOptions) => {
    activeBulkRef.current = false
    setState({
      bulk: false,
      done: 0,
      failed: 0,
      phase: 'running',
      saved: 0,
      skipped: 0,
      status: 'Importing…',
      title: options.title ?? 'Importing recipe',
      total: Math.max(1, options.total),
      unmatchedCount: 0,
    })
  }, [])

  const updateProgress = useCallback((patch: Partial<ImportProgressState>) => {
    setState(current => {
      if (current.phase === 'idle') {
        return current
      }
      return { ...current, ...patch, phase: patch.phase ?? current.phase }
    })
  }, [])

  const completeImport = useCallback((options: CompleteImportOptions = {}) => {
    setState(current => {
      const total = current.total || 1
      const saved = options.saved ?? current.saved
      const skipped = options.skipped ?? current.skipped
      const failed = options.failed ?? current.failed
      return {
        ...current,
        done: total,
        failed,
        phase: 'complete',
        saved,
        skipped,
        status: undefined,
        unmatchedCount: options.unmatchedCount ?? current.unmatchedCount,
      }
    })
  }, [])

  const failImport = useCallback((error: string) => {
    setState(current => ({
      ...current,
      error,
      phase: 'error',
      status: undefined,
    }))
  }, [])

  const publishBulkProgress = useCallback((items: BulkImportItem[], status?: string) => {
    const progress = countBulkProgress(items)
    const done = progress.saved + progress.skipped + progress.failed
    const unmatched = uniqueUnmatchedCount(items)
    setState(current => ({
      ...current,
      bulk: true,
      done,
      failed: progress.failed,
      phase: 'running',
      saved: progress.saved,
      skipped: progress.skipped,
      status:
        status ??
        (progress.converting > 0
          ? `Converting ${progress.converting}…`
          : progress.ready > 0 || savingRef.current
            ? 'Saving…'
            : 'Importing…'),
      total: progress.total || current.total,
      unmatchedCount: unmatched,
    }))
  }, [])

  const saveReadyBulkItems = useCallback(async () => {
    if (savingRef.current || !activeBulkRef.current) {
      return
    }
    const readyItems = itemsRef.current.filter(item => item.status === 'ready')
    if (!readyItems.length) {
      return
    }

    savingRef.current = true
    try {
      if (!existingIndexRef.current) {
        existingIndexRef.current = await loadExistingIndex()
      }
      const existing = existingIndexRef.current
      const usedSlugs = usedSlugsRef.current

      for (const item of readyItems) {
        if (!activeBulkRef.current) {
          break
        }
        const latest = itemsRef.current.find(entry => entry.id === item.id)
        if (!latest || latest.status !== 'ready') {
          continue
        }
        itemsRef.current = itemsRef.current.map(entry =>
          entry.id === item.id ? { ...entry, status: 'saving' as const } : entry
        )
        publishBulkProgress(itemsRef.current, 'Saving…')
        try {
          const saved = await saveBulkImportItem(latest, {
            existing,
            skipExistingBySlug,
            usedSlugs,
          })
          itemsRef.current = itemsRef.current.map(entry => (entry.id === item.id ? saved : entry))
        } catch (saveError) {
          const message = saveError instanceof Error ? saveError.message : 'Save failed'
          itemsRef.current = itemsRef.current.map(entry =>
            entry.id === item.id ? { ...entry, error: message, status: 'failed' as const } : entry
          )
        }
        publishBulkProgress(itemsRef.current)
      }
    } finally {
      savingRef.current = false
      if (activeBulkRef.current && itemsRef.current.some(item => item.status === 'ready')) {
        void saveReadyBulkItems()
      }
    }
  }, [publishBulkProgress, skipExistingBySlug])

  const startBulkImport = useCallback(
    (files: File[]) => {
      if (!files.length) {
        return
      }

      activeBulkRef.current = true
      savingRef.current = false
      existingIndexRef.current = null
      usedSlugsRef.current = new Set()
      const nextItems = createBulkImportItems(files)
      itemsRef.current = nextItems
      setState({
        bulk: true,
        done: 0,
        failed: 0,
        phase: 'running',
        saved: 0,
        skipped: 0,
        status: 'Starting…',
        title: files.length === 1 ? 'Importing recipe' : `Importing ${files.length} recipes`,
        total: files.length,
        unmatchedCount: 0,
      })

      void (async () => {
        try {
          existingIndexRef.current = await loadExistingIndex()
          if (!activeBulkRef.current) {
            return
          }
          await runBulkConvertQueue({
            getCatalog: () => catalogRef.current,
            getExisting: () =>
              existingIndexRef.current ?? { bySlug: new Set(), bySourceUrl: new Map() },
            items: nextItems,
            onItemsChange: updater => {
              if (!activeBulkRef.current) {
                return
              }
              itemsRef.current = updater(itemsRef.current)
              publishBulkProgress(itemsRef.current)
              void saveReadyBulkItems()
            },
            shouldContinue: () => activeBulkRef.current,
            skipExistingBySourceUrl: true,
          })

          // Drain any remaining ready items after convert finishes.
          while (
            activeBulkRef.current &&
            itemsRef.current.some(item => item.status === 'ready' || item.status === 'saving')
          ) {
            await saveReadyBulkItems()
            if (itemsRef.current.some(item => item.status === 'saving')) {
              await new Promise(resolve => setTimeout(resolve, 50))
            }
          }

          if (!activeBulkRef.current) {
            return
          }

          const progress = countBulkProgress(itemsRef.current)
          if (progress.saved > 0) {
            await sync()
            notifyLocalChange()
          }

          completeImport({
            failed: progress.failed,
            saved: progress.saved,
            skipped: progress.skipped,
            unmatchedCount: uniqueUnmatchedCount(itemsRef.current),
          })
        } catch (error) {
          if (activeBulkRef.current) {
            failImport(error instanceof Error ? error.message : 'Could not import files')
          }
        }
      })()
    },
    [completeImport, failImport, notifyLocalChange, publishBulkProgress, saveReadyBulkItems, sync]
  )

  const value = useMemo(
    () => ({
      completeImport,
      dismiss,
      failImport,
      startBulkImport,
      startImport,
      state,
      updateProgress,
    }),
    [completeImport, dismiss, failImport, startBulkImport, startImport, state, updateProgress]
  )

  return (
    <ImportProgressContext.Provider value={value}>
      {children}
      <ImportProgressAlert />
    </ImportProgressContext.Provider>
  )
}

export function useImportProgress() {
  const value = useContext(ImportProgressContext)
  if (!value) {
    throw new Error('useImportProgress must be used within ImportProgressProvider')
  }
  return value
}

function ImportProgressAlert() {
  const { state, dismiss } = useImportProgress()

  useEffect(() => {
    if (state.phase !== 'complete') {
      return
    }
    const timer = window.setTimeout(() => {
      dismiss()
    }, COMPLETE_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [dismiss, state.phase])

  if (state.phase === 'idle') {
    return null
  }

  const percent = state.total <= 0 ? 0 : Math.min(100, Math.round((state.done / state.total) * 100))
  const isRunning = state.phase === 'running'
  const isError = state.phase === 'error'
  const unmatched = state.unmatchedCount
  const showProgressBar = state.bulk && isRunning

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[45] flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-white p-4 shadow-xl ring-1 ring-orange-100 dark:bg-stone-800 dark:ring-stone-700">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              {state.title}
            </p>
            {isError && state.error ? (
              <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">{state.error}</p>
            ) : null}
          </div>
          {!isRunning ? (
            <button
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-700 dark:hover:text-stone-100"
              onClick={dismiss}
              type="button"
            >
              Dismiss
            </button>
          ) : null}
        </div>

        {showProgressBar ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
              <span>
                {state.done} of {state.total}
              </span>
              <span>{percent}%</span>
            </div>
            <div
              aria-label="Import progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={percent}
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-orange-600 transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {state.phase === 'complete' && unmatched > 0 ? (
          <p className="mt-3 text-sm text-stone-700 dark:text-stone-200">
            <Link
              className="font-semibold text-orange-700 underline-offset-2 hover:underline dark:text-orange-400"
              onClick={dismiss}
              to="/ingredients?review=1"
            >
              {unmatched} unmatched ingredient{unmatched === 1 ? '' : 's'}
            </Link>
            {' — review on the Ingredients page'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function uniqueUnmatchedCount(items: BulkImportItem[]): number {
  const names = new Set<string>()
  for (const item of items) {
    if (item.status === 'failed' || item.status === 'skipped') {
      continue
    }
    for (const name of item.unmatchedNames) {
      names.add(name.toLowerCase())
    }
  }
  return names.size
}
