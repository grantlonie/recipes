import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { BulkImportDialog } from './BulkImportDialog'
import { BulkImportPickerDialog } from './BulkImportPickerDialog'
import { useIngredientCatalog } from '../IngredientCatalogContext'
import { useRecipeSync } from '../RecipeSyncContext'

interface BulkImportControlsProps {
  children?: (actions: { openFiles: () => void }) => ReactNode
  onSingleFile?: (file: File) => void
}

export function BulkImportControls({ children, onSingleFile }: BulkImportControlsProps) {
  const queryClient = useQueryClient()
  const { sync } = useRecipeSync()
  const { ingredients: catalog, refresh: refreshCatalog } = useIngredientCatalog()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [bulkFiles, setBulkFiles] = useState<File[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)

  function openFiles() {
    setPickerOpen(true)
  }

  function handlePickerSelect(files: File[]) {
    setPickerOpen(false)
    if (files.length === 1 && onSingleFile) {
      onSingleFile(files[0])
      return
    }
    setBulkFiles(files)
    setBulkOpen(true)
  }

  function closeBulkImport() {
    setBulkOpen(false)
    setBulkFiles([])
  }

  async function completeBulkImport() {
    closeBulkImport()
    await sync()
    await queryClient.invalidateQueries({ queryKey: ['recipes'] })
  }

  return (
    <>
      {children?.({ openFiles })}

      <BulkImportPickerDialog
        onCancel={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        open={pickerOpen}
      />

      <BulkImportDialog
        catalog={catalog}
        files={bulkFiles}
        onClose={closeBulkImport}
        onComplete={() => void completeBulkImport()}
        open={bulkOpen}
        refreshCatalog={refreshCatalog}
        sync={sync}
      />
    </>
  )
}
