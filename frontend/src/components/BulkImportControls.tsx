import type { ReactNode } from 'react'
import { useState } from 'react'

import { BulkImportPickerDialog } from './BulkImportPickerDialog'
import { useImportProgress } from '../ImportProgressContext'

interface BulkImportControlsProps {
  children?: (actions: { openFiles: () => void }) => ReactNode
  onSingleFile?: (file: File) => void
}

export function BulkImportControls({ children, onSingleFile }: BulkImportControlsProps) {
  const { startBulkImport } = useImportProgress()
  const [pickerOpen, setPickerOpen] = useState(false)

  function openFiles() {
    setPickerOpen(true)
  }

  function handlePickerSelect(files: File[]) {
    setPickerOpen(false)
    if (files.length === 1 && onSingleFile) {
      onSingleFile(files[0])
      return
    }
    startBulkImport(files)
  }

  return (
    <>
      {children?.({ openFiles })}

      <BulkImportPickerDialog
        onCancel={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        open={pickerOpen}
      />
    </>
  )
}
