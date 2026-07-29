import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { useNavigate } from 'react-router-dom'

import { IconButton } from './components/IconButton'

interface RecipeDetailHeaderProviderProps {
  children: ReactNode
}

interface RecipeDetailHeaderContextValue {
  setTitle: (title: string) => void
  setTitleInHeader: (visible: boolean) => void
  title: string
  titleInHeader: boolean
}

const RecipeDetailHeaderContext = createContext<RecipeDetailHeaderContextValue | null>(null)

export function RecipeDetailHeaderProvider({ children }: RecipeDetailHeaderProviderProps) {
  const [title, setTitleState] = useState('')
  const [titleInHeader, setTitleInHeaderState] = useState(false)

  const setTitle = useCallback((value: string) => {
    setTitleState(value)
    if (!value) {
      setTitleInHeaderState(false)
    }
  }, [])

  const setTitleInHeader = useCallback((visible: boolean) => {
    setTitleInHeaderState(visible)
  }, [])

  const value = useMemo(
    () => ({
      setTitle,
      setTitleInHeader,
      title,
      titleInHeader,
    }),
    [setTitle, setTitleInHeader, title, titleInHeader]
  )

  return (
    <RecipeDetailHeaderContext.Provider value={value}>
      {children}
    </RecipeDetailHeaderContext.Provider>
  )
}

export function useRecipeDetailHeader() {
  const value = useContext(RecipeDetailHeaderContext)
  if (!value) {
    throw new Error('useRecipeDetailHeader must be used within RecipeDetailHeaderProvider')
  }
  return value
}

export function RecipeDetailHeaderNav() {
  const navigate = useNavigate()
  const { title, titleInHeader } = useRecipeDetailHeader()

  function handleBack() {
    // React Router's history idx > 0 means an in-app entry exists; otherwise
    // browser back would leave the site, so go home instead.
    const historyIndex =
      typeof window.history.state?.idx === 'number' ? window.history.state.idx : 0
    if (historyIndex > 0) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <IconButton
        aria-label="Back"
        className="h-10 w-10"
        icon={<ChevronLeftIcon aria-hidden="true" className="h-6 w-6" />}
        onClick={handleBack}
        tooltip={{ content: 'Back' }}
      />
      <p
        aria-hidden="true"
        className={`min-w-0 truncate text-base font-semibold text-stone-900 transition-opacity duration-200 dark:text-stone-100 ${
          titleInHeader ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {title}
      </p>
    </div>
  )
}
