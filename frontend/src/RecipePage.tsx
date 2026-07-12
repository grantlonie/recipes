import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  ChevronDownIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  ShareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'

import { deleteRecipe, getScaledRecipe, updateRecipeMetadata } from './api'
import { useAuth } from './AuthContext'
import { BookmarkButton } from './components/BookmarkButton'
import { Button } from './components/Button'
import { Dialog } from './components/Dialog'
import { Popover } from './components/Popover'
import { UnitSystemToggle } from './components/UnitSystemToggle'
import { getRecipeBlocks } from './cooklangEditor'
import { extractTokens, formatIngredientLabel } from './cooklangTokens'
import { useIngredientCatalog } from './IngredientCatalogContext'
import { titleCaseIngredient } from './ingredientDisplay'
import { useRecipeDetailHeader } from './RecipeDetailHeaderContext'
import { useRecipeListState } from './RecipeListContext'
import { useRecipeSync } from './RecipeSyncContext'
import { loadRecipeStaleFirst, purgeRecipeIfDeleted, revalidateRecipe, storeRecipe } from './sync'
import { cardClassName, panelClassName } from './themeClasses'
import type { CatalogIngredient, Ingredient, UnitSystem } from './types'
import { densityForName, formatDisplayAmount, formatIngredientAmount } from './units'
import { useUnitSystem } from './UnitSystemContext'

const COOKWARE_RE = /#([^{}#]+)\{\}/g
const TIMER_RE = /~([A-Za-z0-9_./' -]*?)\{([^}]*)\}/g

const ICON_CLASS = 'h-5 w-5'
const IMAGE_ACTION_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center rounded-full p-2 text-white transition hover:bg-white/20'
const OVERFLOW_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center rounded-full p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200'

const SCALE_OPTIONS = [
  { label: '0.5X', value: 0.5 },
  { label: '1X', value: 1 },
  { label: '1.5X', value: 1.5 },
  { label: '2X', value: 2 },
] as const

type ScaleFactor = (typeof SCALE_OPTIONS)[number]['value']

const SCALED_TEXT_CLASS = 'font-semibold text-orange-700 dark:text-orange-300'

const STEP_MARKER_CLASS = {
  cookware:
    'inline rounded-md border border-stone-500 bg-stone-100/90 px-1 font-bold text-stone-900 dark:border-stone-500 dark:bg-stone-700/90 dark:text-stone-100',
  ingredient:
    'inline rounded-md border border-orange-200 bg-orange-100/70 px-1 font-semibold text-stone-900 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-100',
  timer:
    'inline rounded-md border border-amber-400 bg-amber-50/90 px-1 font-medium text-stone-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100',
} as const

const SCALED_INGREDIENT_MARKER_CLASS =
  'inline rounded-md border border-orange-400 bg-orange-100 px-1 font-semibold text-orange-800 dark:border-orange-500 dark:bg-orange-950/60 dark:text-orange-200'

type StepMarker = {
  index: number
  length: number
  text: string
  type: keyof typeof STEP_MARKER_CLASS
}

export function RecipePage() {
  const { '*': slug = '' } = useParams()
  const { auth } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { addRecentRecipe, removeRecentRecipe } = useRecipeListState()
  const { revision, sync } = useRecipeSync()
  const { unitSystem } = useUnitSystem()
  const { ingredients: catalog } = useIngredientCatalog()
  const { setTitle, setTitleInHeader } = useRecipeDetailHeader()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const recipeQuery = useQuery({
    enabled: Boolean(slug),
    queryFn: () =>
      loadRecipeStaleFirst(slug, updated => queryClient.setQueryData(['recipe', slug], updated)),
    queryKey: ['recipe', slug],
    retry: false,
  })
  const [scaleFactor, setScaleFactor] = useState<ScaleFactor>(1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => new Set())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const baseServings = recipeQuery.data?.servings ?? 1
  const targetServings = baseServings * scaleFactor
  const isScaled = scaleFactor !== 1
  const scaledQuery = useQuery({
    enabled: Boolean(slug) && isScaled,
    queryFn: () => getScaledRecipe(slug, targetServings),
    queryKey: ['recipe', slug, 'scale', targetServings],
  })
  const bookmarkMutation = useMutation({
    mutationFn: () => updateRecipeMetadata(slug, { bookmarked: !recipeQuery.data?.bookmarked }),
    onSuccess: async recipe => {
      queryClient.setQueryData(['recipe', slug], recipe)
      await storeRecipe(recipe)
      await sync()
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteRecipe(slug),
    onSuccess: async () => {
      removeRecentRecipe(slug)
      await sync()
      navigate('/')
    },
  })
  const recipe = scaledQuery.data ?? recipeQuery.data

  useEffect(() => {
    if (recipeQuery.data) {
      setScaleFactor(1)
      addRecentRecipe(recipeQuery.data)
    }
  }, [addRecentRecipe, recipeQuery.data])

  useEffect(() => {
    setCompletedSteps(new Set())
  }, [slug])

  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [slug])

  useEffect(() => {
    const title = recipeQuery.data?.title ?? ''
    setTitle(title)
    return () => setTitle('')
  }, [recipeQuery.data?.title, setTitle])

  useEffect(() => {
    const element = titleRef.current
    if (!element || !recipeQuery.data?.title) {
      setTitleInHeader(false)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => setTitleInHeader(!entry.isIntersecting),
      { rootMargin: '-56px 0px 0px 0px', threshold: 0 }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [recipeQuery.data?.title, setTitleInHeader])

  useEffect(() => {
    if (!slug || recipeQuery.isLoading) {
      return
    }
    if (recipeQuery.isError || !recipeQuery.data) {
      removeRecentRecipe(slug)
      navigate('/', { replace: true })
    }
  }, [
    navigate,
    recipeQuery.data,
    recipeQuery.isError,
    recipeQuery.isLoading,
    removeRecentRecipe,
    slug,
  ])

  useEffect(() => {
    if (!slug || revision === 0) {
      return
    }
    let cancelled = false
    void (async () => {
      const deleted = await purgeRecipeIfDeleted(slug)
      if (cancelled) {
        return
      }
      if (deleted) {
        queryClient.removeQueries({ queryKey: ['recipe', slug] })
        removeRecentRecipe(slug)
        navigate('/', { replace: true })
        return
      }
      const updated = await revalidateRecipe(slug)
      if (cancelled) {
        return
      }
      if (updated) {
        queryClient.setQueryData(['recipe', slug], updated)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate, queryClient, removeRecentRecipe, revision, slug])

  if (recipeQuery.isLoading && !recipeQuery.data) {
    return (
      <p className={`rounded-2xl p-6 text-stone-600 dark:text-stone-400 ${panelClassName}`}>
        Loading recipe...
      </p>
    )
  }

  if (!recipe) {
    return null
  }

  const blocks = getRecipeBlocks(recipe)
  const sourceHref = resolveSourceHref(recipe)

  return (
    <article className="space-y-8 pb-8">
      <section className={`${cardClassName} overflow-hidden p-0!`}>
        {recipe.image ? (
          <div className="relative">
            <img
              alt=""
              className="h-[250px] w-full object-cover sm:h-auto sm:max-h-[420px]"
              referrerPolicy="no-referrer"
              src={recipe.image}
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-full bg-black/55 p-1 backdrop-blur-sm">
              {sourceHref ? (
                <a
                  aria-label="View source"
                  className={IMAGE_ACTION_BUTTON_CLASS}
                  href={sourceHref}
                  rel="noreferrer"
                  target="_blank"
                >
                  <DocumentTextIcon aria-hidden="true" className={ICON_CLASS} />
                </a>
              ) : null}
              <button
                aria-label="Share recipe"
                className={IMAGE_ACTION_BUTTON_CLASS}
                onClick={handleShare}
                type="button"
              >
                <ShareIcon aria-hidden="true" className={ICON_CLASS} />
              </button>
              {auth.authenticated ? (
                <BookmarkButton
                  bookmarked={recipe.bookmarked}
                  className={IMAGE_ACTION_BUTTON_CLASS}
                  disabled={bookmarkMutation.isPending}
                  iconClassName={ICON_CLASS}
                  onToggle={handleToggleBookmark}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-1 p-4 pb-0">
            {sourceHref ? (
              <a
                aria-label="View source"
                className={OVERFLOW_BUTTON_CLASS}
                href={sourceHref}
                rel="noreferrer"
                target="_blank"
              >
                <DocumentTextIcon aria-hidden="true" className={ICON_CLASS} />
              </a>
            ) : null}
            <button
              aria-label="Share recipe"
              className={OVERFLOW_BUTTON_CLASS}
              onClick={handleShare}
              type="button"
            >
              <ShareIcon aria-hidden="true" className={ICON_CLASS} />
            </button>
            {auth.authenticated ? (
              <BookmarkButton
                bookmarked={recipe.bookmarked}
                className={OVERFLOW_BUTTON_CLASS}
                disabled={bookmarkMutation.isPending}
                iconClassName={ICON_CLASS}
                onToggle={handleToggleBookmark}
              />
            ) : null}
          </div>
        )}
        <div className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight" ref={titleRef}>
                {recipe.title}
              </h1>
              {recipe.cook_time ? (
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  {recipe.cook_time}
                </p>
              ) : null}
            </div>
            {auth.authenticated ? (
              <Popover
                align="right"
                onClose={() => setOverflowOpen(false)}
                open={overflowOpen}
                trigger={
                  <button
                    aria-expanded={overflowOpen}
                    aria-haspopup="menu"
                    aria-label="Recipe actions"
                    className={OVERFLOW_BUTTON_CLASS}
                    onClick={() => setOverflowOpen(open => !open)}
                    type="button"
                  >
                    <EllipsisVerticalIcon aria-hidden="true" className={ICON_CLASS} />
                  </button>
                }
              >
                <div className="py-1" role="menu">
                  <Link
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-stone-700 transition hover:bg-orange-50 dark:text-stone-200 dark:hover:bg-stone-700"
                    onClick={() => setOverflowOpen(false)}
                    role="menuitem"
                    to={`/recipes/edit/${slug}`}
                  >
                    <PencilSquareIcon
                      aria-hidden="true"
                      className="h-5 w-5 text-orange-600 dark:text-orange-400"
                    />
                    Edit
                  </Link>
                  <button
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      setOverflowOpen(false)
                      setDeleteDialogOpen(true)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <TrashIcon aria-hidden="true" className="h-5 w-5" />
                    Delete
                  </button>
                </div>
              </Popover>
            ) : null}
          </div>
        </div>
      </section>

      <Dialog labelledBy="delete-recipe-title" open={deleteDialogOpen}>
        <h2
          className="text-lg font-semibold text-stone-900 dark:text-stone-100"
          id="delete-recipe-title"
        >
          Delete recipe?
        </h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Delete &ldquo;{recipe.title}&rdquo;? This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={() => setDeleteDialogOpen(false)} variant="ghost">
            Cancel
          </Button>
          <Button disabled={deleteMutation.isPending} onClick={handleDelete} variant="danger">
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-6">
          <section className={panelClassName}>
            <h2 className="text-lg font-semibold">Ingredients</h2>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <output
                aria-live="polite"
                className={`tabular-nums font-semibold ${isScaled ? SCALED_TEXT_CLASS : 'text-stone-600 dark:text-stone-400'}`}
                id="servings"
              >
                Serves {formatServings(targetServings)}
              </output>
              <div className="flex items-center gap-5">
                <ScalePopover onChange={setScaleFactor} value={scaleFactor} />
                <UnitSystemToggle />
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              {recipe.ingredients.map((ingredient, index) => (
                <Fragment key={`${ingredient.name}-${index}`}>
                  <span
                    className={`tabular-nums ${isScaled ? SCALED_TEXT_CLASS : 'text-stone-600 dark:text-stone-400'}`}
                  >
                    {formatIngredientListAmount(ingredient, unitSystem, catalog)}
                    {ingredient.fixed ? ' fixed' : ''}
                  </span>
                  <span className={isScaled ? SCALED_TEXT_CLASS : undefined}>
                    {titleCaseIngredient(formatIngredientLabel(ingredient.name, ingredient.note))}
                  </span>
                </Fragment>
              ))}
            </ul>
          </section>

          {recipe.cookware.length ? (
            <section className={panelClassName}>
              <h2 className="text-lg font-semibold">Cookware</h2>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
                {recipe.cookware.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <div className="space-y-6">
          {recipe.notes.length ? (
            <section className={panelClassName}>
              <h2 className="text-lg font-semibold">Notes</h2>
              <div className="mt-3 space-y-3 text-stone-700 dark:text-stone-300">
                {recipe.notes.map(note => (
                  <ExpandableNote key={note} text={note} />
                ))}
              </div>
            </section>
          ) : null}

          <section className={panelClassName}>
            <h2 className="text-lg font-semibold">Steps</h2>
            <div className="mt-4 space-y-4">
              {blocks.map((block, index) => {
                if (block.kind === 'section') {
                  return (
                    <h3
                      className="pt-1 text-sm font-bold uppercase tracking-wide text-orange-800"
                      key={`section-${index}`}
                    >
                      {block.title}
                    </h3>
                  )
                }

                const stepIndex = blocks.slice(0, index).filter(item => item.kind === 'step').length
                const completed = completedSteps.has(stepIndex)
                const checkboxId = `step-${stepIndex + 1}-complete`

                return (
                  <div
                    className={`rounded-xl bg-orange-50 p-4 transition-all dark:bg-stone-800/80 ${
                      completed ? 'py-2' : ''
                    }`}
                    key={`step-${index}`}
                  >
                    <label
                      className={`flex cursor-pointer items-center gap-3 text-sm font-semibold text-orange-700 ${
                        completed ? '' : 'mb-2'
                      }`}
                      htmlFor={checkboxId}
                    >
                      <input
                        checked={completed}
                        className="h-4 w-4 rounded border-orange-300 text-orange-600 accent-orange-600"
                        id={checkboxId}
                        onChange={() => toggleStepCompletion(stepIndex)}
                        type="checkbox"
                      />
                      <span>Step {stepIndex + 1}</span>
                    </label>
                    {completed ? null : (
                      <p className="whitespace-pre-line text-stone-800 dark:text-stone-200">
                        {renderCooklangStep(block.text, unitSystem, catalog, isScaled)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>

      {recipe.tags.length ? (
        <section className={cardClassName}>
          <h2 className="text-lg font-semibold">Tags</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {recipe.tags.map(tag => (
              <span
                className="rounded-full bg-orange-100 px-3 py-1 text-sm text-orange-800 dark:bg-orange-950/60 dark:text-orange-200"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  )

  function toggleStepCompletion(index: number) {
    setCompletedSteps(current => {
      const next = new Set(current)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  async function handleShare() {
    if (!recipe) {
      return
    }
    const shareData = { title: recipe.title, url: recipe.public_url }
    if (navigator.share) {
      await navigator.share(shareData)
      return
    }
    await navigator.clipboard.writeText(recipe.public_url)
  }

  async function handleToggleBookmark() {
    if (!recipeQuery.data) {
      return
    }
    await bookmarkMutation.mutateAsync()
  }

  async function handleDelete() {
    if (!recipe) {
      return
    }
    await deleteMutation.mutateAsync()
    setDeleteDialogOpen(false)
  }
}

interface ScalePopoverProps {
  onChange: (value: ScaleFactor) => void
  value: ScaleFactor
}

function ScalePopover({ onChange, value }: ScalePopoverProps) {
  const [open, setOpen] = useState(false)
  const currentLabel = SCALE_OPTIONS.find(option => option.value === value)?.label ?? '1X'

  return (
    <Popover
      align="right"
      onClose={() => setOpen(false)}
      open={open}
      trigger={
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Recipe scale"
          className="inline-flex items-center gap-1 border-0 bg-transparent py-0.5 text-xs font-semibold text-orange-600 focus:outline-none focus:ring-0 dark:text-orange-300"
          onClick={() => setOpen(current => !current)}
          type="button"
        >
          {currentLabel}
          <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="py-1" role="listbox">
        {SCALE_OPTIONS.map(option => (
          <button
            aria-selected={option.value === value}
            className={`block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-orange-50 dark:hover:bg-stone-700 ${
              option.value === value
                ? 'font-semibold text-orange-700 dark:text-orange-300'
                : 'text-stone-700 dark:text-stone-200'
            }`}
            key={option.value}
            onClick={() => {
              onChange(option.value)
              setOpen(false)
            }}
            role="option"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </Popover>
  )
}

interface ExpandableNoteProps {
  text: string
}

function ExpandableNote({ text }: ExpandableNoteProps) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const element = textRef.current
    if (!element || expanded) {
      return
    }
    setClamped(element.scrollHeight > element.clientHeight + 1)
  }, [expanded, text])

  return (
    <div>
      <p className={expanded ? undefined : 'line-clamp-4'} ref={textRef}>
        {text}
      </p>
      {clamped || expanded ? (
        <button
          className="mt-2 text-sm font-semibold text-orange-700 hover:underline"
          onClick={() => setExpanded(current => !current)}
          type="button"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
}

function renderCooklangStep(
  step: string,
  unitSystem: UnitSystem,
  catalog: CatalogIngredient[],
  isScaled: boolean
) {
  const lines = step.split('\n')
  if (lines.length === 1) {
    return renderCooklangLine(step, unitSystem, catalog, isScaled)
  }
  return lines.map((line, index) => (
    <Fragment key={`${index}-${line}`}>
      {index > 0 ? '\n' : null}
      {renderCooklangLine(line, unitSystem, catalog, isScaled)}
    </Fragment>
  ))
}

function renderCooklangLine(
  line: string,
  unitSystem: UnitSystem,
  catalog: CatalogIngredient[],
  isScaled: boolean
) {
  const markers: StepMarker[] = []

  for (const token of extractTokens(line)) {
    markers.push({
      index: token.start,
      length: token.end - token.start,
      text: formatIngredientFromToken(token, unitSystem, catalog),
      type: 'ingredient',
    })
  }

  COOKWARE_RE.lastIndex = 0
  for (const match of line.matchAll(COOKWARE_RE)) {
    const [marker, name] = match
    markers.push({
      index: match.index ?? 0,
      length: marker.length,
      text: name.trim(),
      type: 'cookware',
    })
  }

  TIMER_RE.lastIndex = 0
  for (const match of line.matchAll(TIMER_RE)) {
    const [marker, name, amount] = match
    markers.push({
      index: match.index ?? 0,
      length: marker.length,
      text: formatTimerPhrase(name.trim(), amount),
      type: 'timer',
    })
  }

  markers.sort((left, right) => left.index - right.index)

  const rendered: ReactNode[] = []
  let cursor = 0
  let markerIndex = 0

  for (const marker of markers) {
    if (marker.index < cursor) {
      continue
    }
    if (marker.index > cursor) {
      rendered.push(line.slice(cursor, marker.index))
    }
    rendered.push(
      <span
        className={
          marker.type === 'ingredient' && isScaled
            ? SCALED_INGREDIENT_MARKER_CLASS
            : STEP_MARKER_CLASS[marker.type]
        }
        key={`${marker.index}-${markerIndex}`}
      >
        {marker.text}
      </span>
    )
    cursor = marker.index + marker.length
    markerIndex += 1
  }

  if (cursor < line.length) {
    rendered.push(line.slice(cursor))
  }

  return rendered.length ? rendered : line
}

function formatServings(value: number) {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return String(value)
}

function resolveSourceHref(recipe: {
  metadata?: Record<string, unknown>
  original_url?: string | null
}): string | null {
  const raw = recipe.metadata?.source
  const source = typeof raw === 'string' ? raw.trim() : ''
  if (source.startsWith('recipes/')) {
    return `/api/sources/${source.slice('recipes/'.length)}`
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return source
  }
  return recipe.original_url?.trim() || null
}

function formatIngredientListAmount(
  ingredient: Ingredient,
  unitSystem: UnitSystem,
  catalog: CatalogIngredient[]
) {
  const amount = formatIngredientAmount(
    ingredient.scaled_quantity ?? ingredient.quantity,
    ingredient.unit,
    {
      densityKgM3: densityForName(ingredient.name, catalog),
      unitSystem,
    }
  )
  return formatDisplayAmount(amount)
}

function formatIngredientFromToken(
  token: ReturnType<typeof extractTokens>[number],
  unitSystem: UnitSystem,
  catalog: CatalogIngredient[]
) {
  if (!token.quantity) {
    return formatIngredientLabel(token.name, token.note)
  }
  const display = formatIngredientAmount(token.quantity, token.unit, {
    densityKgM3: densityForName(token.name, catalog),
    unitSystem,
  })
  const formatted = formatDisplayAmount(display)
  if (!formatted) {
    return formatIngredientLabel(token.name, token.note)
  }
  return `${formatted} ${formatIngredientLabel(token.name, token.note)}`
}

function formatTimerPhrase(name: string, amount: string) {
  const { quantity, unit } = splitAmount(amount)
  if (name) {
    return name
  }
  if (!quantity) {
    return amount
  }
  if (!unit) {
    return quantity
  }
  return `${quantity} ${unit}`
}

function splitAmount(amount: string) {
  const [quantity, unit] = amount.split('%', 2).map(part => part.trim())
  return { quantity: quantity?.replace(/^=/, '') ?? '', unit: unit ?? '' }
}
