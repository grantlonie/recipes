import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'ghost' | 'primary' | 'secondary' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
}

const variants: Record<ButtonVariant, string> = {
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-stone-700 hover:bg-orange-100 dark:text-stone-200 dark:hover:bg-stone-700',
  primary: 'bg-orange-600 text-white hover:bg-orange-700',
  secondary:
    'bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-stone-700 dark:text-orange-200 dark:hover:bg-stone-600',
}

export function Button({ children, className = '', variant = 'primary', ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  )
}
