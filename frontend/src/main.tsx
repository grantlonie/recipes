import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import { AuthProvider } from './AuthContext'
import { IngredientCatalogProvider } from './IngredientCatalogContext'
import { UnitSystemProvider } from './UnitSystemContext'
import './index.css'
import { registerServiceWorker } from './registerServiceWorker'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UnitSystemProvider>
          <IngredientCatalogProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </IngredientCatalogProvider>
        </UnitSystemProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
)

registerServiceWorker()
