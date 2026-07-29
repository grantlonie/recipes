import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

import { errorTextClassName, inputClassName } from '../themeClasses'

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
    <Dialog
      footer={
        <>
          <Button disabled={importing} onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={!canImport || importing} form="website-import-form" type="submit">
            {importing ? 'Importing...' : 'Import'}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      size="sm"
      title="Import from website"
      titleId="website-import-dialog-title"
    >
      <form id="website-import-form" onSubmit={handleSubmit}>
        <p className="text-sm text-stone-600 dark:text-stone-400">
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

        {error ? <p className={`mt-3 text-sm ${errorTextClassName}`}>{error}</p> : null}
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
