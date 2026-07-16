import {
  CameraIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../AuthContext'
import { BulkImportControls } from './BulkImportControls'
import { Button } from './Button'
import { CameraCaptureDialog, isCameraCaptureSupported } from './CameraCaptureDialog'
import { Dialog } from './Dialog'
import { ImportMappingDialog } from './ImportMappingDialog'
import { ImportingDialog } from './ImportingDialog'
import { Popover } from './Popover'
import { WebsiteImportDialog } from './WebsiteImportDialog'
import { useIngredientCatalog } from '../IngredientCatalogContext'
import { applyImportMapping, type MappingRow, type PendingImport } from '../importMapping'
import {
  buildImportContentFromPending,
  finalizeImportedRecipe,
  formatImportError,
  importRecipeFromFile,
  importRecipeFromUrl,
  persistImportedRecipe,
  prepareImportMapping,
  scheduleMappingDensityAutofill,
  type RecipeImportResult,
} from '../importRecipeFlow'
import { buildLoginUrl } from '../shareImport'
import { useRecipeSync } from '../RecipeSyncContext'
import { errorTextClassName } from '../themeClasses'
import type { ImportPreview } from '../types'

export function NewRecipeFab() {
  const { auth } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { sync } = useRecipeSync()
  const { ingredients: catalog, refresh: refreshCatalog } = useIngredientCatalog()
  const [menuOpen, setMenuOpen] = useState(false)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importErrorDialogOpen, setImportErrorDialogOpen] = useState(false)
  const [cameraDialogOpen, setCameraDialogOpen] = useState(false)
  const [mappingApplying, setMappingApplying] = useState(false)
  const [mappingError, setMappingError] = useState<string | null>(null)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([])
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [pendingSourceFile, setPendingSourceFile] = useState<File | undefined>()
  const [pendingSuggestedSlug, setPendingSuggestedSlug] = useState('')
  const cameraFallbackRef = useRef<HTMLInputElement>(null)

  const saveMutation = useMutation({
    mutationFn: async ({
      content,
      sourceFile,
      suggestedSlug,
    }: {
      content: string
      sourceFile?: File
      suggestedSlug: string
    }) => {
      const recipe = await finalizeImportedRecipe(content, suggestedSlug, sourceFile)
      await persistImportedRecipe(recipe, sync)
      return recipe
    },
    onSuccess: recipe => {
      clearPendingMapping()
      setImportError(null)
      setUrlDialogOpen(false)
      queryClient.setQueryData(['recipe', recipe.slug], recipe)
      navigate(`/recipes/${recipe.slug}`)
    },
    onError: error => {
      const message = formatImportError(error)
      setImportError(message)
      if (pendingImport) {
        setMappingError(message)
        setMappingOpen(true)
        return
      }
      setImportErrorDialogOpen(true)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (input: { file?: File; url?: string }) => {
      if (input.url) {
        return importRecipeFromUrl(input.url)
      }
      if (input.file) {
        return importRecipeFromFile(input.file)
      }
      throw new Error('Nothing to import')
    },
    onMutate: () => {
      setUrlDialogOpen(false)
    },
    onSuccess: result => {
      setImportError(null)
      setUrlDialogOpen(false)
      void handleImportResult(result)
    },
    onError: (error, variables) => {
      const message = formatImportError(error)
      setImportError(message)
      if (variables.url) {
        setUrlDialogOpen(true)
        return
      }
      setImportErrorDialogOpen(true)
    },
  })

  function clearPendingMapping() {
    setMappingApplying(false)
    setMappingError(null)
    setMappingOpen(false)
    setMappingRows([])
    setPendingImport(null)
    setPendingSourceFile(undefined)
    setPendingSuggestedSlug('')
  }

  async function saveImportedContent(preview: ImportPreview, content: string, sourceFile?: File) {
    await saveMutation.mutateAsync({
      content,
      sourceFile,
      suggestedSlug: preview.suggested_slug,
    })
  }

  async function handleImportResult(result: RecipeImportResult) {
    if (result.kind === 'existing') {
      navigate(`/recipes/${result.recipe.slug}`)
      return
    }

    const prepared = prepareImportMapping(result.preview, catalog)
    if (!prepared) {
      await saveImportedContent(result.preview, result.preview.content, result.sourceFile)
      return
    }

    setMappingError(null)
    setPendingSuggestedSlug(result.preview.suggested_slug)
    setPendingSourceFile(result.sourceFile)
    setPendingImport(prepared.pendingImport)
    setMappingRows(prepared.mappingRows)
    setMappingOpen(true)
    scheduleMappingDensityAutofill(prepared.mappingRows, catalog, setMappingRows)
  }

  async function applyMapping() {
    if (!pendingImport || mappingApplying) {
      return
    }

    setMappingApplying(true)
    setMappingError(null)
    setImportError(null)
    try {
      const { body } = await applyImportMapping(pendingImport, mappingRows, catalog, refreshCatalog)
      const content = buildImportContentFromPending(pendingImport, body)
      setMappingOpen(false)
      await saveMutation.mutateAsync({
        content,
        sourceFile: pendingSourceFile,
        suggestedSlug: pendingSuggestedSlug,
      })
    } catch (error) {
      const message = formatImportError(error)
      setMappingError(message)
      setImportError(message)
      setMappingOpen(true)
    } finally {
      setMappingApplying(false)
    }
  }

  function closeMenu() {
    setMenuOpen(false)
  }

  function requireEditor(run: () => void) {
    if (!auth.authenticated) {
      closeMenu()
      navigate(buildLoginUrl('/'))
      return
    }
    run()
  }

  function openUrlDialog() {
    requireEditor(() => {
      closeMenu()
      setImportError(null)
      setUrlDialogOpen(true)
    })
  }

  function openCamera() {
    requireEditor(() => {
      closeMenu()
      if (isCameraCaptureSupported()) {
        setCameraDialogOpen(true)
        return
      }
      cameraFallbackRef.current?.click()
    })
  }

  function openManualEntry() {
    closeMenu()
    navigate(auth.authenticated ? '/recipes/new' : buildLoginUrl('/recipes/new'))
  }

  function handleWebsiteImport(url: string) {
    setImportError(null)
    importMutation.mutate({ url })
  }

  function handleCapturedPhoto(file: File) {
    setCameraDialogOpen(false)
    setImportError(null)
    importMutation.mutate({ file })
  }

  function handleCameraFallbackSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    handleCapturedPhoto(file)
  }

  function handleSingleFileImport(file: File) {
    setImportError(null)
    importMutation.mutate({ file })
  }

  function updateMappingRow(index: number, patch: Partial<MappingRow>) {
    setMappingRows(current =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    )
  }

  const busy = importMutation.isPending || saveMutation.isPending || mappingApplying

  return (
    <>
      <input
        accept="image/*"
        className="hidden"
        onChange={handleCameraFallbackSelected}
        ref={cameraFallbackRef}
        type="file"
      />

      <BulkImportControls onSingleFile={handleSingleFileImport}>
        {({ openFiles }) => (
          <div className="fixed bottom-6 right-6 z-40">
            <Popover
              align="right"
              onClose={closeMenu}
              open={menuOpen}
              placement="top"
              trigger={
                <button
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label="New recipe"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-orange-600 text-3xl font-light text-white shadow-lg transition hover:bg-orange-700"
                  onClick={() => setMenuOpen(open => !open)}
                  type="button"
                >
                  +
                </button>
              }
            >
              <div className="py-1" role="menu">
                <NewRecipeMenuItem
                  icon={<GlobeAltIcon className="h-5 w-5" />}
                  label="Website"
                  onClick={openUrlDialog}
                />
                <NewRecipeMenuItem
                  icon={<CameraIcon className="h-5 w-5" />}
                  label="Camera"
                  onClick={openCamera}
                />
                <NewRecipeMenuItem
                  icon={<DocumentTextIcon className="h-5 w-5" />}
                  label="Files"
                  onClick={() =>
                    requireEditor(() => {
                      closeMenu()
                      openFiles()
                    })
                  }
                />
                <NewRecipeMenuItem
                  icon={<PencilSquareIcon className="h-5 w-5" />}
                  label="Text"
                  onClick={openManualEntry}
                />
              </div>
            </Popover>
          </div>
        )}
      </BulkImportControls>

      <CameraCaptureDialog
        onCapture={handleCapturedPhoto}
        onClose={() => setCameraDialogOpen(false)}
        open={cameraDialogOpen}
        title="Photograph recipe"
      />

      <WebsiteImportDialog
        error={importError}
        importing={busy}
        onClose={() => {
          setUrlDialogOpen(false)
          setImportError(null)
        }}
        onImport={handleWebsiteImport}
        open={urlDialogOpen}
      />

      <ImportMappingDialog
        applying={mappingApplying || saveMutation.isPending}
        catalog={catalog}
        error={mappingError}
        onApply={() => void applyMapping()}
        onCancel={() => {
          clearPendingMapping()
          setImportError(null)
        }}
        onUpdateRow={updateMappingRow}
        open={mappingOpen}
        rows={mappingRows}
      />

      <ImportingDialog open={busy && !mappingOpen} />

      <Dialog labelledBy="import-error-dialog-title" open={importErrorDialogOpen}>
        <h2
          className="text-xl font-bold text-stone-900 dark:text-stone-100"
          id="import-error-dialog-title"
        >
          Couldn&apos;t import recipe
        </h2>
        <p className={`mt-3 text-sm ${errorTextClassName}`}>{importError}</p>
        <div className="mt-6 flex justify-end">
          <Button
            onClick={() => {
              setImportErrorDialogOpen(false)
              setImportError(null)
            }}
            type="button"
          >
            OK
          </Button>
        </div>
      </Dialog>
    </>
  )
}

interface NewRecipeMenuItemProps {
  icon: ReactNode
  label: string
  onClick: () => void
}

function NewRecipeMenuItem({ icon, label, onClick }: NewRecipeMenuItemProps) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-stone-700 transition hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="text-orange-600 dark:text-orange-400">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
