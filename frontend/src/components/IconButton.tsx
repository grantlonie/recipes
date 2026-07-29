import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { Button } from './Button'
import type { TooltipProps } from './Tooltip'
import { Tooltip } from './Tooltip'

type ButtonVariant = 'ghost' | 'primary' | 'secondary' | 'danger'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  'aria-label': string
  icon: ReactNode
  tone?: 'default' | 'onMedia'
  tooltip?: Omit<TooltipProps, 'children'>
  variant?: ButtonVariant
}

const SIZE_CLASS =
  'inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full p-0!'

const TONE_CLASS: Record<NonNullable<IconButtonProps['tone']>, string> = {
  default: '',
  onMedia:
    '!text-white hover:!bg-white/20 hover:!text-white dark:!text-white dark:hover:!bg-white/20',
}

export function IconButton({
  className = '',
  disabled,
  icon,
  tone = 'default',
  tooltip,
  type = 'button',
  variant = 'ghost',
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      className={`${SIZE_CLASS} ${TONE_CLASS[tone]} ${className}`}
      disabled={disabled}
      type={type}
      variant={variant}
      {...props}
    >
      {icon}
    </Button>
  )

  if (!tooltip || disabled) {
    return button
  }

  return <Tooltip {...tooltip}>{button}</Tooltip>
}
