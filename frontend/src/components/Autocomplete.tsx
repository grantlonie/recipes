import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { inputClassName } from '../themeClasses'
import { normalizeIngredientKey } from '../units'

export interface AutocompleteOption {
  label: string
  value: string
}

export interface AutocompleteHeader {
  label: string
  type: 'header'
}

export type AutocompleteItem = AutocompleteOption | AutocompleteHeader

interface AutocompleteProps {
  allowCustom?: boolean
  allowEmpty?: boolean
  disabled?: boolean
  onChange: (value: string) => void
  options: AutocompleteItem[]
  placeholder?: string
  value: string
}

export function Autocomplete({
  allowCustom = true,
  allowEmpty = false,
  disabled = false,
  onChange,
  options,
  placeholder,
  value,
}: AutocompleteProps) {
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [query, setQuery] = useState(() => displayLabel(value, options))
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null)

  useEffect(() => {
    setQuery(displayLabel(value, options))
  }, [options, value])

  const suggestions = useMemo(() => filterItems(options, query), [options, query])

  useEffect(() => {
    setHighlight(firstSelectableIndex(suggestions))
  }, [suggestions])

  const updatePosition = useCallback(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    const rect = input.getBoundingClientRect()
    setCoords({ left: rect.left, top: rect.bottom + 4, width: rect.width })
  }, [])

  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    updatePosition()
    const frame = requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return
      }
      commitQuery(query)
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, query])

  return (
    <div ref={containerRef}>
      <input
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        autoComplete="off"
        className={`${inputClassName} disabled:bg-stone-100 disabled:text-stone-500 dark:disabled:bg-stone-800 dark:disabled:text-stone-500`}
        disabled={disabled}
        onChange={event => {
          const next = event.target.value
          setQuery(next)
          setOpen(true)
          if (allowCustom || (allowEmpty && next === '')) {
            onChange(next)
          }
        }}
        onFocus={() => {
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        value={query}
      />
      {open && !disabled && suggestions.length && coords
        ? createPortal(
            <ul
              className="fixed z-60 max-h-48 overflow-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-orange-100 dark:bg-stone-800 dark:ring-stone-700"
              id={listId}
              ref={panelRef}
              role="listbox"
              style={{ left: coords.left, top: coords.top, width: coords.width }}
            >
              {suggestions.map((item, index) => {
                if (isHeader(item)) {
                  return (
                    <li
                      className="px-3 pb-0.5 pt-2 text-[10px] font-normal uppercase tracking-wide text-stone-400 first:pt-1 dark:text-stone-500"
                      key={`header-${item.label}-${index}`}
                      role="presentation"
                    >
                      {item.label}
                    </li>
                  )
                }

                const active = index === highlight
                return (
                  <li key={`${item.value}\0${item.label}`} role="option">
                    <button
                      className={`block w-full px-3 py-2 text-left text-sm ${
                        active
                          ? 'bg-orange-100 font-semibold text-orange-900 dark:bg-orange-950/50 dark:text-orange-200'
                          : 'text-stone-700 hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700'
                      }`}
                      onMouseDown={event => {
                        event.preventDefault()
                        selectOption(item)
                      }}
                      onMouseEnter={() => setHighlight(index)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body
          )
        : null}
    </div>
  )

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight(current => nextSelectableIndex(suggestions, current, 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(current => nextSelectableIndex(suggestions, current, -1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = suggestions[highlight]
      if (open && selected && !isHeader(selected)) {
        selectOption(selected)
      } else {
        commitQuery(query)
        setOpen(false)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery(displayLabel(value, options))
      setOpen(false)
      return
    }
    if (event.key === 'Tab') {
      commitQuery(query)
      setOpen(false)
    }
  }

  function selectOption(option: AutocompleteOption) {
    onChange(option.value)
    setQuery(option.label)
    setOpen(false)
  }

  function commitQuery(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed && allowEmpty) {
      onChange('')
      setQuery('')
      return
    }
    const exact = selectableOptions(options).find(
      option =>
        normalizeIngredientKey(option.value) === normalizeIngredientKey(trimmed) ||
        normalizeIngredientKey(option.label) === normalizeIngredientKey(trimmed)
    )
    if (exact) {
      onChange(exact.value)
      setQuery(exact.label)
      return
    }
    if (allowCustom) {
      onChange(trimmed)
      setQuery(trimmed)
      return
    }
    setQuery(displayLabel(value, options))
  }
}

function isHeader(item: AutocompleteItem): item is AutocompleteHeader {
  return 'type' in item && item.type === 'header'
}

function selectableOptions(items: AutocompleteItem[]): AutocompleteOption[] {
  return items.filter((item): item is AutocompleteOption => !isHeader(item))
}

function filterItems(items: AutocompleteItem[], query: string): AutocompleteItem[] {
  const needle = normalizeIngredientKey(query)
  if (!needle) {
    return items
  }

  const result: AutocompleteItem[] = []
  let index = 0
  while (index < items.length) {
    const item = items[index]
    if (isHeader(item)) {
      const header = item
      const groupOptions: AutocompleteOption[] = []
      index += 1
      while (index < items.length && !isHeader(items[index])) {
        const option = items[index] as AutocompleteOption
        if (
          matchesIngredientQuery(option.label, needle) ||
          matchesIngredientQuery(option.value, needle)
        ) {
          groupOptions.push(option)
        }
        index += 1
      }
      if (groupOptions.length) {
        result.push(header)
        result.push(...groupOptions)
      }
      continue
    }

    const option = item
    if (
      matchesIngredientQuery(option.label, needle) ||
      matchesIngredientQuery(option.value, needle)
    ) {
      result.push(option)
    }
    index += 1
  }
  return result
}

function firstSelectableIndex(items: AutocompleteItem[]): number {
  const index = items.findIndex(item => !isHeader(item))
  return index === -1 ? 0 : index
}

function nextSelectableIndex(
  items: AutocompleteItem[],
  current: number,
  direction: 1 | -1
): number {
  let index = current + direction
  while (index >= 0 && index < items.length) {
    if (!isHeader(items[index])) {
      return index
    }
    index += direction
  }
  return current
}

function displayLabel(value: string, options: AutocompleteItem[]) {
  return selectableOptions(options).find(option => option.value === value)?.label ?? value
}

function matchesIngredientQuery(target: string, query: string): boolean {
  return normalizeIngredientKey(target).includes(normalizeIngredientKey(query))
}
