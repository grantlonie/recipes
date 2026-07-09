import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

import { inputClassName } from '../themeClasses'

import { Button } from './Button'
import { Dialog } from './Dialog'

interface WebsiteImportDialogProps {
  error?: string | null
  importing?: boolean
  onClose: () => void
  onImport: (url: string) => void
  open: boolean
}

export function WebsiteImportDialog({
  error,
  importing = false,
  onClose,
  onImport,
  open,
}: WebsiteImportDialogProps) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!open) {
      setUrl('')
    }
  }, [open])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = normalizeUrl(url)
    if (!normalized) {
      return
    }
    onImport(normalized)
  }

  const canImport = Boolean(normalizeUrl(url))

  return (
    <Dialog className="max-w-lg" labelledBy="website-import-dialog-title" open={open}>
      <form onSubmit={handleSubmit}>
        <h2
          className="text-xl font-bold text-stone-900 dark:text-stone-100"
          id="website-import-dialog-title"
        >
          Import from website
        </h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Paste a recipe URL to import.
        </p>

        <input
          autoFocus
          className={`${inputClassName} mt-4`}
          onChange={event => setUrl(event.target.value)}
          placeholder="https://example.com/recipe"
          type="text"
          value={url}
        />

        {error ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button disabled={importing} onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={!canImport || importing} type="submit">
            {importing ? 'Importing...' : 'Import'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {
    return null
  }

  return null
}
