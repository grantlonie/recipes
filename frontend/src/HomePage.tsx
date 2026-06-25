import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { ChangeEvent } from 'react'
import { useMemo, useState } from 'react'

import { getGroups, getRecipes, getTags } from './api'
import type { RecipeSummary } from './types'

export function HomePage() {
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const recipesQuery = useQuery({
    queryFn: () => getRecipes(query),
    queryKey: ['recipes', query],
  })
  const groupsQuery = useQuery({ queryFn: getGroups, queryKey: ['groups'] })
  const tagsQuery = useQuery({ queryFn: getTags, queryKey: ['tags'] })
  const recipes = useMemo(
    () => filterRecipes(recipesQuery.data ?? [], activeGroup, activeTag, groupsQuery.data ?? []),
    [activeGroup, activeTag, groupsQuery.data, recipesQuery.data]
  )

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
          Cooklang collection
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">All your recipes in one place.</h1>
        <p className="mt-3 max-w-2xl text-stone-600">
          Search by recipe name first, then tags, notes, ingredients, and recipe text.
        </p>
        <label className="mt-6 block">
          <span className="sr-only">Search recipes</span>
          <input
            className="w-full rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-lg outline-none ring-orange-500 focus:ring-2"
            onChange={handleQueryChange}
            placeholder="Search recipes"
            type="search"
            value={query}
          />
        </label>
      </section>

      <section className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-6">
          <FilterSection
            active={activeGroup}
            items={(groupsQuery.data ?? []).map(group => ({
              label: group.title,
              value: group.slug,
            }))}
            onClear={() => setActiveGroup(null)}
            onSelect={setActiveGroup}
            title="Groups"
          />
          <FilterSection
            active={activeTag}
            items={(tagsQuery.data ?? []).map(tag => ({ label: tag, value: tag }))}
            onClear={() => setActiveTag(null)}
            onSelect={setActiveTag}
            title="Tags"
          />
        </aside>

        <div>
          {recipesQuery.isLoading ? (
            <p className="rounded-2xl bg-white p-6 text-stone-600">Loading recipes...</p>
          ) : recipes.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {recipes.map(recipe => (
                <RecipeCard key={recipe.slug} recipe={recipe} />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl bg-white p-6 text-stone-600">No recipes found.</p>
          )}
        </div>
      </section>
    </div>
  )

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value)
  }
}

interface FilterItem {
  label: string
  value: string
}

interface FilterSectionProps {
  active: string | null
  items: FilterItem[]
  onClear: () => void
  onSelect: (value: string) => void
  title: string
}

function FilterSection({ active, items, onClear, onSelect, title }: FilterSectionProps) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-orange-100">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {active ? (
          <button
            className="text-sm text-orange-700 hover:underline"
            onClick={onClear}
            type="button"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 lg:block lg:space-y-2">
        {items.map(item => (
          <button
            className={`rounded-full px-3 py-1.5 text-sm lg:w-full lg:text-left ${
              active === item.value
                ? 'bg-orange-600 text-white'
                : 'bg-orange-100 text-stone-700 hover:bg-orange-200'
            }`}
            key={item.value}
            onClick={() => onSelect(item.value)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface RecipeCardProps {
  recipe: RecipeSummary
}

function RecipeCard({ recipe }: RecipeCardProps) {
  return (
    <Link
      className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-orange-100 transition hover:-translate-y-0.5 hover:shadow-md"
      to={`/recipes/${recipe.slug}`}
    >
      {recipe.image ? (
        <img
          alt=""
          className="h-40 w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={recipe.image}
        />
      ) : (
        <div className="flex h-40 items-center justify-center bg-orange-100">
          <img alt="" className="h-28 w-28 object-contain opacity-90" src="/web-app-icon-512.png" />
        </div>
      )}
      <div className="space-y-3 p-4">
        <h2 className="text-xl font-semibold group-hover:text-orange-700">{recipe.title}</h2>
        <div className="flex flex-wrap gap-2">
          {recipe.tags.slice(0, 4).map(tag => (
            <span
              className="rounded-full bg-orange-100 px-2.5 py-1 text-xs text-orange-800"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="text-sm text-stone-600">
          {recipe.servings} servings{recipe.cook_time ? ` · ${recipe.cook_time}` : ''}
        </p>
      </div>
    </Link>
  )
}

function filterRecipes(
  recipes: RecipeSummary[],
  activeGroup: string | null,
  activeTag: string | null,
  groups: { recipes: string[]; slug: string }[]
) {
  const groupRecipes = activeGroup
    ? new Set(groups.find(group => group.slug === activeGroup)?.recipes ?? [])
    : null

  return recipes.filter(recipe => {
    if (groupRecipes && !groupRecipes.has(recipe.slug)) {
      return false
    }
    if (activeTag && !recipe.tags.includes(activeTag)) {
      return false
    }
    return true
  })
}
