import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export type ThemePreference = 'device' | 'light' | 'dark'

const STORAGE_KEY = 'recipes.theme'

interface ThemeContextValue {
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: ThemePreference) => void
  theme: ThemePreference
}

interface ThemeProviderProps {
  children: ReactNode
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemePreference>(readTheme)
  const [systemDark, setSystemDark] = useState(readSystemDark)

  const resolvedTheme: 'light' | 'dark' =
    theme === 'device' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    applyThemeClass(resolvedTheme)
    updateThemeColorMeta(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setSystemDark(media.matches)
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    window.localStorage.setItem(STORAGE_KEY, nextTheme)
    setThemeState(nextTheme)
  }, [])

  const value = useMemo(
    () => ({
      resolvedTheme,
      setTheme,
      theme,
    }),
    [resolvedTheme, setTheme, theme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return value
}

export function readTheme(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'device' || stored === 'light' || stored === 'dark') {
    return stored
  }
  return 'device'
}

function readSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyThemeClass(resolvedTheme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
}

function updateThemeColorMeta(resolvedTheme: 'light' | 'dark') {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', resolvedTheme === 'dark' ? '#1c1917' : '#f97316')
  }
}
