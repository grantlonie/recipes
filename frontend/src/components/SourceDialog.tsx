import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'

import { getSourceText } from '../api'
import { Button } from './Button'
import { Dialog } from './Dialog'

interface SourceDialogProps {
  href: string | null
  onClose: () => void
  open: boolean
}

const IMAGE_SOURCE_RE = /\.(?:heic|jpe?g|png|webp)(?:\?|$)/i

export function SourceDialog({ href, onClose, open }: SourceDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null)
  const showImage = Boolean(href && IMAGE_SOURCE_RE.test(href) && !text && !loading)

  useEffect(() => {
    if (!open || !href) {
      setError(null)
      setLoading(false)
      setText(null)
      setWebsiteUrl(null)
      return
    }

    let cancelled = false
    setError(null)
    setLoading(true)
    setText(null)
    setWebsiteUrl(null)

    void (async () => {
      try {
        const response = await getSourceText(href)
        if (cancelled) {
          return
        }
        setText(response.text)
        setWebsiteUrl(response.website_url?.trim() || null)
      } catch (loadError) {
        if (cancelled) {
          return
        }
        if (IMAGE_SOURCE_RE.test(href)) {
          setError(null)
          return
        }
        setError(loadError instanceof Error ? loadError.message : 'Could not load source')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [href, open])

  return (
    <Dialog className="max-w-3xl" labelledBy="source-dialog-title" open={open}>
      <div className="flex items-start justify-between gap-3">
        <h2
          className="text-lg font-semibold text-stone-900 dark:text-stone-100"
          id="source-dialog-title"
        >
          Source
        </h2>
        {websiteUrl ? (
          <a
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1.5 text-sm font-semibold text-orange-800 transition hover:bg-orange-200 dark:bg-stone-700 dark:text-orange-200 dark:hover:bg-stone-600"
            href={websiteUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open from source
            <ArrowTopRightOnSquareIcon aria-hidden="true" className="h-4 w-4" />
          </a>
        ) : null}
      </div>

      <div className="mt-4 min-h-32">
        {loading ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">Loading source...</p>
        ) : null}
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {showImage && href ? (
          <img
            alt="Recipe source"
            className="max-h-[60vh] w-full rounded-2xl object-contain"
            referrerPolicy="no-referrer"
            src={href}
          />
        ) : null}
        {text ? (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-2xl bg-orange-50/80 p-4 text-sm leading-relaxed text-stone-800 ring-1 ring-orange-100/80 dark:bg-stone-900/50 dark:text-stone-200 dark:ring-stone-700">
            {text}
          </pre>
        ) : null}
        {!loading && !error && !text && !showImage ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">No source content available.</p>
        ) : null}
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={onClose} type="button" variant="ghost">
          Close
        </Button>
      </div>
    </Dialog>
  )
}
