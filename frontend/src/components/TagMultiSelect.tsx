import type { KeyboardEvent } from 'react'
import { useMemo, useState } from 'react'

interface TagMultiSelectProps {
  availableTags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  value: string[]
}

export function TagMultiSelect({
  availableTags,
  onChange,
  placeholder = 'Add tag',
  value,
}: TagMultiSelectProps) {
  const [input, setInput] = useState('')
  const selected = new Set(value.map(normalizeTag))
  const suggestions = useMemo(
    () =>
      availableTags
        .filter(tag => !selected.has(normalizeTag(tag)))
        .filter(tag => normalizeTag(tag).includes(normalizeTag(input.trim())))
        .slice(0, 8),
    [availableTags, input, selected]
  )

  return (
    <div className="rounded-xl border border-orange-200 bg-white p-2 dark:border-stone-600 dark:bg-stone-900">
      <div className="flex flex-wrap gap-2">
        {value.map(tag => (
          <button
            className="rounded-full bg-orange-100 px-3 py-1 text-sm text-orange-800 hover:bg-orange-200 dark:bg-orange-950/60 dark:text-orange-200 dark:hover:bg-orange-900/60"
            key={tag}
            onClick={() => removeTag(tag)}
            type="button"
          >
            {tag} ×
          </button>
        ))}
        <input
          className="min-w-32 flex-1 bg-transparent px-2 py-1 text-stone-900 outline-none dark:text-stone-100"
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          value={input}
        />
      </div>
      {suggestions.length ? (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-orange-100 pt-2 dark:border-stone-700">
          {suggestions.map(tag => (
            <button
              className="rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-700 hover:bg-orange-100 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
              key={tag}
              onClick={() => addTag(tag)}
              type="button"
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(input)
    }
    if (event.key === 'Backspace' && !input && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  function addTag(tag: string) {
    const trimmed = tag.trim()
    if (!trimmed || selected.has(normalizeTag(trimmed))) {
      setInput('')
      return
    }
    onChange([...value, trimmed].sort((left, right) => left.localeCompare(right)))
    setInput('')
  }

  function removeTag(tag: string) {
    onChange(value.filter(item => item !== tag))
  }
}

function normalizeTag(tag: string) {
  return tag.toLocaleLowerCase()
}
