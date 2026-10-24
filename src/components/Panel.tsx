import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/cn'

/** White, rounded and softly lifted. The app's single card shape. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('panel', className)}>{children}</section>
}

export type Tone = 'default' | 'accent' | 'good' | 'danger' | 'warn' | 'muted'

export const TONE_TEXT: Record<Tone, string> = {
  default: 'text-ink',
  accent: 'text-accent',
  good: 'text-good',
  danger: 'text-danger',
  warn: 'text-warn',
  muted: 'text-ink-faint'
}

/**
 * A named value: a plain label and a large mono reading.
 * The pairing repeats everywhere, so it is one component rather than a habit.
 */
export function Readout({
  label,
  value,
  suffix,
  tone = 'default',
  size = 'md'
}: {
  label: string
  value: string
  suffix?: string
  tone?: Tone
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const SIZE = {
    sm: 'text-[1.375rem]',
    md: 'text-[1.875rem]',
    lg: 'text-[2.5rem]',
    xl: 'text-[3.25rem] md:text-[3.75rem]'
  }[size]

  return (
    <div>
      <p className="label">{label}</p>
      <p className={cn('readout mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1', SIZE, TONE_TEXT[tone])}>
        {value}
        {suffix ? (
          <span className="font-sans text-[1.0625rem] font-medium tracking-normal text-ink-muted">{suffix}</span>
        ) : null}
      </p>
    </div>
  )
}

/** A row in a list, divided from the next by a hairline. */
export function DataRow({
  className,
  children,
  onClick,
  bare = false
}: {
  className?: string
  children: ReactNode
  onClick?: () => void
  /** Drops the dividing rule so a caller can own the row's edges entirely. */
  bare?: boolean
}) {
  const base = cn(
    'flex min-h-16 w-full items-center gap-3.5 py-3.5 text-left',
    !bare && 'border-b border-line last:border-b-0'
  )

  if (!onClick) return <div className={cn(base, className)}>{children}</div>

  return (
    <button type="button" onClick={onClick} className={cn(base, 'hover-row -mx-2 rounded-xl px-2 active:opacity-70', className)}>
      {children}
    </button>
  )
}

/** A section's heading, with an optional action at the right. */
export function SectionHead({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
      <h2 className="title text-[1.25rem]">{label}</h2>
      {action}
    </div>
  )
}

/** A tappable row with an icon, a title and a line of detail, as in Settings. */
export function ActionRow({
  icon,
  title,
  detail,
  onClick,
  destructive = false
}: {
  icon: ReactNode
  title: string
  detail: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <DataRow onClick={onClick} className="py-4">
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-xl',
          destructive ? 'bg-danger-wash text-danger' : 'bg-elevated text-ink'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[1.0625rem] font-medium', destructive && 'text-danger')}>{title}</span>
        <span className="mt-0.5 block text-[0.95rem] text-ink-muted">{detail}</span>
      </span>
      <ChevronRight size={20} className="shrink-0 text-ink-faint" aria-hidden />
    </DataRow>
  )
}
