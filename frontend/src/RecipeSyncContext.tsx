import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

import { runSync } from './sync'

export type SyncStatus = 'idle' | 'syncing' | 'error'

interface RecipeSyncContextValue {
  error: string | null
  /** Bumps after local recipe writes (bookmark, save) so list UIs reload from IndexedDB. */
  localRevision: number
  notifyLocalChange: () => void
  /** Bumps after a network sync completes; detail pages may revalidate against the server. */
  revision: number
  status: SyncStatus
  sync: () => Promise<void>
}

const RecipeSyncContext = createContext<RecipeSyncContextValue | null>(null)

interface RecipeSyncProviderProps {
  children: ReactNode
}

export function RecipeSyncProvider({ children }: RecipeSyncProviderProps) {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [localRevision, setLocalRevision] = useState(0)

  const notifyLocalChange = useCallback(() => {
    setLocalRevision(current => current + 1)
  }, [])

  const sync = useCallback(async () => {
    setStatus('syncing')
    setError(null)
    try {
      await runSync()
      setRevision(current => current + 1)
      setLocalRevision(current => current + 1)
      setStatus('idle')
    } catch (syncError) {
      setStatus('error')
      setError(syncError instanceof Error ? syncError.message : 'Sync failed')
    }
  }, [])

  const value = useMemo(
    () => ({
      error,
      localRevision,
      notifyLocalChange,
      revision,
      status,
      sync,
    }),
    [error, localRevision, notifyLocalChange, revision, status, sync]
  )

  return <RecipeSyncContext.Provider value={value}>{children}</RecipeSyncContext.Provider>
}

export function useRecipeSync() {
  const value = useContext(RecipeSyncContext)
  if (!value) {
    throw new Error('useRecipeSync must be used within RecipeSyncProvider')
  }
  return value
}
