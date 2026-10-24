import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * The frame for screens outside the app shell (sign-in and first-time
 * setup): a white card on the grey page, with an optional companion column on
 * wide screens. On a phone the card is the whole screen. It owns its own
 * scroll region.
 */
export function Frame({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="scroll-region h-full bg-surface md:bg-bg">
      <div
        className={cn(
          'mx-auto flex min-h-full w-full items-center justify-center gap-6 md:px-8',
          aside ? 'max-w-[68rem]' : 'max-w-[36rem]'
        )}
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))'
        }}
      >
        <div className="w-full max-w-[34rem] px-5 py-4 md:rounded-[1.75rem] md:border md:border-line md:bg-surface md:px-10 md:py-11 md:shadow-(--shadow-card)">
          {children}
        </div>
        {aside ? <div className="hidden min-h-[36rem] w-full max-w-[30rem] self-stretch lg:block">{aside}</div> : null}
      </div>
    </div>
  )
}
