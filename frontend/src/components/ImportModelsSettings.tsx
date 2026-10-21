import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isEqual } from 'lodash-es'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { getImportModels, updateImportModels } from '../api'
import { useAuth } from '../AuthContext'
import { buildLoginUrl } from '../shareImport'
import type { ImportModels } from '../types'
import { Button } from './Button'

const EMPTY: ImportModels = {
  bulk: '',
  fireworks_dashboard_url: 'https://app.fireworks.ai',
  fireworks_models_url: 'https://fireworks.ai/models',
  repair: '',
  text: '',
  vision: '',
}

type Draft = Pick<ImportModels, 'bulk' | 'repair' | 'text' | 'vision'>

const FIELDS: { key: keyof Draft; label: string; hint: string }[] = [
  {
    hint: 'URL, pasted text, and file imports (first pass).',
    key: 'text',
    label: 'Text import',
  },
  {
    hint: 'Photo / scanned recipe imports.',
    key: 'vision',
    label: 'Vision import',
  },
  {
    hint: 'Second pass when the first Cooklang result needs repair.',
    key: 'repair',
    label: 'Repair',
  },
  {
    hint: 'Bulk density estimates for the ingredient catalog.',
    key: 'bulk',
    label: 'Bulk / density',
  },
]

function toDraft(models: ImportModels): Draft {
  return {
    bulk: models.bulk,
    repair: models.repair,
    text: models.text,
    vision: models.vision,
  }
}

export function ImportModelsSettings() {
  const { auth } = useAuth()
  const queryClient = useQueryClient()
  const modelsQuery = useQuery({
    enabled: auth.authenticated,
    queryFn: getImportModels,
    queryKey: ['settings', 'import-models'],
  })
  const [initial, setInitial] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    if (!modelsQuery.data) {
      return
    }
    const next = toDraft(modelsQuery.data)
    setInitial(next)
    setDraft(next)
  }, [modelsQuery.data])

  const saveMutation = useMutation({
    mutationFn: updateImportModels,
    onSuccess: saved => {
      queryClient.setQueryData(['settings', 'import-models'], saved)
      const next = toDraft(saved)
      setInitial(next)
      setDraft(next)
    },
  })

  if (!auth.authenticated) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Import models</h2>
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          Sign in as an editor to choose Fireworks models for recipe import.
        </p>
        <div className="mt-3">
          <Link
            className="inline-flex rounded-full bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-200 dark:bg-stone-700 dark:text-orange-200 dark:hover:bg-stone-600"
            to={buildLoginUrl('/settings')}
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  if (modelsQuery.isLoading || !draft || !initial) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Import models</h2>
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">Loading models…</p>
      </div>
    )
  }

  if (modelsQuery.isError) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Import models</h2>
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {modelsQuery.error instanceof Error
            ? modelsQuery.error.message
            : 'Could not load import models.'}
        </p>
      </div>
    )
  }

  const dirty = !isEqual(draft, initial)
  const links = modelsQuery.data ?? EMPTY

  function handleCancel() {
    setDraft(initial)
    saveMutation.reset()
  }

  function handlePrimary() {
    if (!dirty || !draft) {
      return
    }
    saveMutation.mutate(draft)
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">
            Import models
          </h2>
          <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
            Fireworks model IDs used when importing and repairing recipes.
          </p>
        </div>
        <a
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-stone-700"
          href={links.fireworks_dashboard_url}
          rel="noopener noreferrer"
          target="_blank"
        >
          Fireworks
          <ArrowTopRightOnSquareIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="mt-3 space-y-3">
        {FIELDS.map(field => (
          <label className="block" key={field.key}>
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">
              {field.label}
            </span>
            <span className="mt-0.5 block text-[11px] text-stone-500 dark:text-stone-400">
              {field.hint}
            </span>
            <input
              className="mt-1.5 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 font-mono text-xs text-stone-800 focus:border-orange-400 focus:outline-none dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
              disabled={saveMutation.isPending}
              onChange={event =>
                setDraft(current =>
                  current ? { ...current, [field.key]: event.target.value } : current
                )
              }
              spellCheck={false}
              value={draft[field.key]}
            />
          </label>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-stone-500 dark:text-stone-400">
        Copy IDs from the{' '}
        <a
          className="font-semibold text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
          href={links.fireworks_models_url}
          rel="noopener noreferrer"
          target="_blank"
        >
          Fireworks model library
        </a>
        .
      </p>

      {saveMutation.isError ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {saveMutation.error instanceof Error
            ? saveMutation.error.message
            : 'Could not save import models.'}
        </p>
      ) : null}

      {dirty ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            className="!px-3 !py-1.5 text-xs"
            disabled={saveMutation.isPending}
            onClick={handleCancel}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            className="w-16 !px-3 !py-1.5 text-xs"
            disabled={saveMutation.isPending}
            onClick={handlePrimary}
            type="button"
            variant="primary"
          >
            {saveMutation.isPending ? '…' : 'Save'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
