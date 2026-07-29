import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

import { Tooltip } from './Tooltip'

interface DensitySearchLinkProps {
  ingredientName: string
}

export function DensitySearchLink({ ingredientName }: DensitySearchLinkProps) {
  const label = ingredientName.trim() || 'ingredient'
  const query = `bulk density of ${label} in kg/m3`

  return (
    <Tooltip content={`Search density of ${label}`}>
      <a
        aria-label={`Search density of ${label}`}
        className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-stone-500 transition hover:bg-orange-100 hover:text-orange-700 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-orange-300"
        href={`https://www.google.com/search?q=${encodeURIComponent(query)}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <MagnifyingGlassIcon aria-hidden="true" className="h-5 w-5" />
      </a>
    </Tooltip>
  )
}
