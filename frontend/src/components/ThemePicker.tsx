import { ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/react/24/outline'

import { type ThemePreference, useTheme } from '../ThemeContext'

const OPTIONS: {
  description: string
  icon: typeof SunIcon
  label: string
  value: ThemePreference
}[] = [
  {
    description: 'Match your device settings',
    icon: ComputerDesktopIcon,
    label: 'Device',
    value: 'device',
  },
  {
    description: 'Always use light mode',
    icon: SunIcon,
    label: 'Light',
    value: 'light',
  },
  {
    description: 'Always use dark mode',
    icon: MoonIcon,
    label: 'Dark',
    value: 'dark',
  },
]

export function ThemePicker() {
  const { setTheme, theme } = useTheme()

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-stone-700 dark:text-stone-200">
        Appearance
      </legend>
      <div className="mt-3 grid gap-2">
        {OPTIONS.map(option => {
          const Icon = option.icon
          const selected = theme === option.value

          return (
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                selected
                  ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-300 dark:border-orange-500 dark:bg-orange-950/40 dark:ring-orange-700'
                  : 'border-orange-200 bg-white hover:bg-orange-50 dark:border-stone-600 dark:bg-stone-900 dark:hover:bg-stone-800'
              }`}
              key={option.value}
            >
              <input
                checked={selected}
                className="sr-only"
                name="theme"
                onChange={() => setTheme(option.value)}
                type="radio"
                value={option.value}
              />
              <span
                className={`inline-flex rounded-full p-2 ${
                  selected
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-200'
                    : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
                }`}
              >
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {option.label}
                </span>
                <span className="block text-xs text-stone-600 dark:text-stone-400">
                  {option.description}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
