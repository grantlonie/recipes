import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

interface DensitySearchLinkProps {
  ingredientName: string
}

export function DensitySearchLink({ ingredientName }: DensitySearchLinkProps) {
  const label = ingredientName.trim() || 'ingredient'
  const query = `density of ${label} in kg/m3`

  return (
    <a
      aria-label={`Search density of ${label}`}
      className="inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-stone-500 transition hover:bg-orange-100 hover:text-orange-700"
      href={`https://www.google.com/search?q=${encodeURIComponent(query)}`}
      rel="noopener noreferrer"
      target="_blank"
      title={`Search: ${query}`}
    >
      <MagnifyingGlassIcon aria-hidden="true" className="h-5 w-5" />
    </a>
  )
}
