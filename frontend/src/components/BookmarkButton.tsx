interface BookmarkButtonProps {
  bookmarked: boolean
  className?: string
  disabled?: boolean
  label?: string
  onToggle: () => void
}

export function BookmarkButton({
  bookmarked,
  className = '',
  disabled,
  label,
  onToggle,
}: BookmarkButtonProps) {
  return (
    <button
      aria-label={label ?? (bookmarked ? 'Remove bookmark' : 'Bookmark recipe')}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-xl shadow-sm ring-1 ring-orange-100 transition hover:bg-orange-100 disabled:opacity-60 ${className}`}
      disabled={disabled}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      type="button"
    >
      <span aria-hidden="true">{bookmarked ? '★' : '☆'}</span>
    </button>
  )
}
