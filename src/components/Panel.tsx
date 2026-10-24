import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/** Hairline-outlined container. The app's single card shape. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('panel', className)}>{children}</section>
}

/**
 * A named value: small caps label, large mono reading.
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
  tone?: 'default' | 'accent' | 'danger' | 'muted'
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const TONE = {
    default: 'text-ink',
    accent: 'text-accent',
    danger: 'text-danger',
    muted: 'text-ink-faint'
  }[tone]

  const SIZE = {
    sm: 'text-[1.05rem]',
    md: 'text-[1.55rem]',
    lg: 'text-[2.1rem]',
    xl: 'text-[3.4rem]'
  }[size]

  return (
    <div>
      <p className="label">{label}</p>
      <p className={cn('readout mt-2 flex items-baseline gap-1', SIZE, TONE)}>
        {value}
        {suffix ? <span className="text-[0.55em] text-ink-faint">{suffix}</span> : null}
      </p>
    </div>
  )
}

/**
 * A borderless table row divided by hairlines, as used for the schedule list
 * in the reference layout.
 */
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
    'flex w-full items-center gap-3 py-3.5 text-left',
    !bare && 'border-b border-line last:border-b-0'
  )

  if (!onClick) return <div className={cn(base, className)}>{children}</div>

  return (
    <button type="button" onClick={onClick} className={cn(base, 'active:opacity-60', className)}>
      {children}
    </button>
  )
}

/** Section heading with an optional trailing action, matching the `+ADD` rule. */
export function SectionHead({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mb-1 flex items-end justify-between gap-3 border-b border-line pb-2.5">
      <h2 className="label">{label}</h2>
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
      <span className={cn('shrink-0', destructive ? 'text-danger' : 'text-ink-muted')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[0.85rem]', destructive && 'text-danger')}>{title}</span>
        <span className="label mt-1.5 block normal-case">{detail}</span>
      </span>
    </DataRow>
  )
}
