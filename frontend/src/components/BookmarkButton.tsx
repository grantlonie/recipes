import { BookmarkIcon as BookmarkIconOutline } from '@heroicons/react/24/outline'
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid'

import { IconButton } from './IconButton'

interface BookmarkButtonProps {
  bookmarked: boolean
  className?: string
  disabled?: boolean
  iconClassName?: string
  label?: string
  onToggle: () => void
  tone?: 'default' | 'onMedia'
  tooltip?: boolean
}

export function BookmarkButton({
  bookmarked,
  className = '',
  disabled,
  iconClassName = 'h-5 w-5',
  label,
  onToggle,
  tone = 'default',
  tooltip = true,
}: BookmarkButtonProps) {
  const Icon = bookmarked ? BookmarkIconSolid : BookmarkIconOutline
  const tip = label ?? (bookmarked ? 'Remove bookmark' : 'Bookmark')

  return (
    <IconButton
      aria-label={tip}
      className={className}
      disabled={disabled}
      icon={<Icon aria-hidden="true" className={iconClassName} />}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      tone={tone}
      tooltip={tooltip ? { content: tip } : undefined}
    />
  )
}
