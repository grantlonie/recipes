import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { getLocalIngredientCatalog, putIngredientCatalog } from './db'
import { loadIngredientCatalogStaleFirst } from './sync'
import type { CatalogIngredient, IngredientCatalog } from './types'
import { findCatalogIngredient } from './units'

interface IngredientCatalogContextValue {
  catalog: IngredientCatalog
  findIngredient: (name: string) => CatalogIngredient | undefined
  ingredients: CatalogIngredient[]
  refresh: () => Promise<void>
}

interface IngredientCatalogProviderProps {
  children: ReactNode
}

const emptyCatalog: IngredientCatalog = { ingredients: [], version: 0 }

const IngredientCatalogContext = createContext<IngredientCatalogContextValue | null>(null)

export function IngredientCatalogProvider({ children }: IngredientCatalogProviderProps) {
  const queryClient = useQueryClient()
  const catalogQuery = useQuery({
    queryFn: () =>
      loadIngredientCatalogStaleFirst(updated => {
        queryClient.setQueryData(['ingredients'], updated)
      }),
    queryKey: ['ingredients'],
  })

  const catalog = catalogQuery.data ?? emptyCatalog

  const value = useMemo<IngredientCatalogContextValue>(
    () => ({
      catalog,
      findIngredient: (name: string) => findCatalogIngredient(name, catalog.ingredients),
      ingredients: catalog.ingredients,
      refresh: async () => {
        const local = await getLocalIngredientCatalog()
        if (local) {
          queryClient.setQueryData(['ingredients'], local)
        }
        await catalogQuery.refetch()
      },
    }),
    [catalog, catalogQuery, queryClient]
  )

  return (
    <IngredientCatalogContext.Provider value={value}>{children}</IngredientCatalogContext.Provider>
  )
}

export function useIngredientCatalog() {
  const value = useContext(IngredientCatalogContext)
  if (!value) {
    throw new Error('useIngredientCatalog must be used within IngredientCatalogProvider')
  }
  return value
}

export async function storeIngredientCatalog(catalog: IngredientCatalog) {
  await putIngredientCatalog(catalog)
}
