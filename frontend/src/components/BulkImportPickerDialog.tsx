import type { ChangeEvent, DragEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import { Button } from './Button'
import { Dialog } from './Dialog'
import { isBulkImportSelectionFile, normalizeBulkImportSelection } from '../bulkImport'
import { errorTextClassName } from '../themeClasses'

const SOURCE_ACCEPT = 'image/*,.pdf,.docx,.txt,.html,.htm,.md,.markdown,.zip,application/zip'

interface BulkImportPickerDialogProps {
  onCancel: () => void
  onSelect: (files: File[]) => void
  open: boolean
}

export function BulkImportPickerDialog({ onCancel, onSelect, open }: BulkImportPickerDialogProps) {
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const filesInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = folderInputRef.current
    if (!input) {
      return
    }
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
  }, [open])

  useEffect(() => {
    if (!open) {
      setPreparing(false)
      setError(null)
      setDragActive(false)
    }
  }, [open])

  async function handleSelection(selected: File[]) {
    if (!selected.length) {
      return
    }
    setPreparing(true)
    setError(null)
    try {
      const normalized = await normalizeBulkImportSelection(selected)
      if (!normalized.length) {
        setError('No supported recipe files found in that selection.')
        return
      }
      onSelect(normalized)
    } catch (normalizeError) {
      setError(
        normalizeError instanceof Error
          ? normalizeError.message
          : 'Could not read the selected files or zip.'
      )
    } finally {
      setPreparing(false)
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files ? [...event.target.files] : []
    event.target.value = ''
    void handleSelection(selected)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    // Snapshot during the drop event — DataTransfer is unreliable after awaits.
    const files = await collectDroppedFiles(event.dataTransfer)
    void handleSelection(files)
  }

  return (
    <Dialog labelledBy="bulk-import-picker-title" open={open}>
      <h2 className="text-xl font-bold" id="bulk-import-picker-title">
        Import files
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Choose one or more recipe files, a folder, or a zip. Multiple files are imported as a batch.
      </p>

      <input
        accept={SOURCE_ACCEPT}
        className="hidden"
        multiple
        onChange={handleInputChange}
        ref={filesInputRef}
        type="file"
      />
      <input
        accept={SOURCE_ACCEPT}
        className="hidden"
        multiple
        onChange={handleInputChange}
        ref={folderInputRef}
        type="file"
      />

      <div
        className={`mt-5 rounded-3xl border-2 border-dashed px-4 py-10 text-center transition ${
          dragActive
            ? 'border-orange-500 bg-orange-50 dark:bg-stone-900'
            : 'border-orange-200 bg-orange-50/60 dark:border-stone-600 dark:bg-stone-900/60'
        }`}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={event => void handleDrop(event)}
      >
        <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
          Drop files, a folder, or a zip here
        </p>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          Supports txt, html, md, pdf, docx, images, and zip archives
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button
            disabled={preparing}
            onClick={() => filesInputRef.current?.click()}
            type="button"
            variant="secondary"
          >
            Choose files
          </Button>
          <Button
            disabled={preparing}
            onClick={() => folderInputRef.current?.click()}
            type="button"
            variant="secondary"
          >
            Choose folder
          </Button>
        </div>
      </div>

      {preparing ? (
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">Preparing files…</p>
      ) : null}
      {error ? <p className={`mt-3 text-sm ${errorTextClassName}`}>{error}</p> : null}

      <div className="mt-6 flex justify-end">
        <Button disabled={preparing} onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
      </div>
    </Dialog>
  )
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const filesFromList = [...dataTransfer.files]
  const entries: FileSystemEntry[] = []
  for (const item of dataTransfer.items) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) {
      entries.push(entry)
    }
  }

  const hasDirectory = entries.some(entry => entry.isDirectory)
  if (!hasDirectory) {
    const supported = filesFromList.filter(isBulkImportSelectionFile)
    if (supported.length) {
      return supported
    }
  }

  const nested: File[] = []
  for (const entry of entries) {
    nested.push(...(await readFileSystemEntry(entry)))
  }
  if (nested.length) {
    return nested
  }
  return filesFromList.filter(isBulkImportSelectionFile)
}

async function readFileSystemEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry)
    return isBulkImportSelectionFile(file) ? [file] : []
  }
  if (!entry.isDirectory) {
    return []
  }

  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const children = await readAllDirectoryEntries(reader)
  const files: File[] = []
  for (const child of children) {
    files.push(...(await readFileSystemEntry(child)))
  }
  return files
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = []

    function readBatch() {
      reader.readEntries(batch => {
        if (!batch.length) {
          resolve(entries)
          return
        }
        entries.push(...batch)
        readBatch()
      }, reject)
    }

    readBatch()
  })
}
