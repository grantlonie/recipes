import { BookmarkIcon as BookmarkIconOutline } from '@heroicons/react/24/outline'
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid'

interface BookmarkButtonProps {
  bookmarked: boolean
  className?: string
  disabled?: boolean
  iconClassName?: string
  label?: string
  onToggle: () => void
}

export function BookmarkButton({
  bookmarked,
  className = '',
  disabled,
  iconClassName = 'h-6 w-6',
  label,
  onToggle,
}: BookmarkButtonProps) {
  const Icon = bookmarked ? BookmarkIconSolid : BookmarkIconOutline

  return (
    <button
      aria-label={label ?? (bookmarked ? 'Remove bookmark' : 'Bookmark recipe')}
      className={`inline-flex items-center justify-center p-1 text-orange-600 transition hover:text-orange-700 disabled:opacity-60 ${className}`}
      disabled={disabled}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      type="button"
    >
      <Icon aria-hidden="true" className={iconClassName} />
    </button>
  )
}
