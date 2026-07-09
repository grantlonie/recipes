import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'

import { ChevronLeftIcon } from '@heroicons/react/24/outline'

interface RecipeDetailHeaderContextValue {
  setTitle: (title: string) => void
  setTitleInHeader: (visible: boolean) => void
  title: string
  titleInHeader: boolean
}

const RecipeDetailHeaderContext = createContext<RecipeDetailHeaderContextValue | null>(null)

export function RecipeDetailHeaderProvider({ children }: { children: ReactNode }) {
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
    [setTitle, setTitleInHeader, title, titleInHeader],
  )

  return (
    <RecipeDetailHeaderContext.Provider value={value}>{children}</RecipeDetailHeaderContext.Provider>
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
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <button
        aria-label="Back to recipes"
        className="inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-stone-700 transition hover:bg-orange-100 dark:text-stone-200 dark:hover:bg-stone-700"
        onClick={handleBack}
        type="button"
      >
        <ChevronLeftIcon aria-hidden="true" className="h-6 w-6" />
      </button>
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
