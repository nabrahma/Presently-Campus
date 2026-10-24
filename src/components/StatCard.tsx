import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { TONE_TEXT, type Tone } from './Panel'

/**
 * A headline figure, built like the cards in the reference layout: the number
 * and its picture in a recessed area, and underneath, an icon with the name
 * of what is being counted. The name sits at the bottom so the eye lands on
 * the number first and the words confirm it.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  tone = 'default',
  detail,
  children,
  className
}: {
  icon: LucideIcon
  label: string
  value: string
  suffix?: string
  tone?: Tone
  /** A short line under the number: a course, a count, a target. */
  detail?: ReactNode
  /** A meter or chart drawn under the number. */
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('panel flex flex-col p-2', className)}>
      <div className="inset flex-1 px-4 pt-4 pb-4 md:px-5 md:pt-5">
        <p className={cn('readout flex flex-wrap items-baseline gap-x-2 text-[2.5rem] md:text-[2.75rem]', TONE_TEXT[tone])}>
          {value}
          {suffix ? <span className="font-sans text-[1.0625rem] font-medium tracking-normal text-ink-muted">{suffix}</span> : null}
        </p>
        {detail ? <p className="mt-2 truncate text-[1rem] text-ink-muted">{detail}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
      <p className="flex items-center gap-3 px-3 pt-3.5 pb-2.5 text-[1.0625rem] font-medium">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-surface">
          <Icon size={18} strokeWidth={2.2} />
        </span>
        {label}
      </p>
    </section>
  )
}
