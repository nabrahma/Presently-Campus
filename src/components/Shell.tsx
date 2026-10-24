import { Suspense, useEffect, useRef, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { CircleSlash, House, Layers, Radio, ScanLine, Settings2, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Booting } from './Booting'
import { cn } from '../lib/cn'
import { useSession } from '../lib/session'
import type { Role } from '../types'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
}

/** Each role gets its own dock; the shell is otherwise the same for both. */
export const NAV: Record<Role, NavItem[]> = {
  student: [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/scan', label: 'Scan', icon: ScanLine, end: false },
    { to: '/courses', label: 'Courses', icon: Layers, end: false },
    { to: '/settings', label: 'Settings', icon: Settings2, end: false }
  ],
  teacher: [
    { to: '/', label: 'Courses', icon: Layers, end: true },
    { to: '/live', label: 'Live', icon: Radio, end: true },
    { to: '/approvals', label: 'Approvals', icon: ShieldCheck, end: false },
    { to: '/settings', label: 'Settings', icon: Settings2, end: false }
  ]
}

/**
 * The persistent frame every screen renders into.
 *
 * One layout, three sizes. Below `md` it is a phone: a bottom dock and a single
 * column. From `md` the same nav becomes a sidebar rail. From `lg` screens get
 * the room for the two-column workspaces the screens themselves opt into.
 *
 * The navigation is a single element that restyles rather than a phone copy
 * plus a desktop copy, so there is only ever one set of links in the document.
 */
export function Shell() {
  const location = useLocation()
  const { online, profile } = useSession()
  const nav = NAV[profile?.role ?? 'student']
  const scrollRef = useRef<HTMLElement>(null)

  // A persistent scroll container keeps its offset, so without this, arriving
  // at a new screen already scrolled halfway down is the default. Assigning
  // scrollTop is an instant jump, which is what a navigation should be.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [location.pathname])

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      <nav
        aria-label="Sections"
        className={cn(
          // Phone: a floating dock pinned under the content.
          'order-last shrink-0 px-4 pt-2 md:order-first',
          // Desktop: a full-height rail beside it.
          'md:flex md:w-[13.5rem] md:flex-col md:border-r md:border-line md:px-3 md:py-5 lg:w-[15rem]',
          // The safe area only exists on the phone layout; the rail ignores it.
          'pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-5'
        )}
      >
        <span className="mb-1 hidden px-3 md:block">
          <span className="label">Menu</span>
        </span>

        <div
          className={cn(
            'flex items-center gap-1 rounded-full border border-line bg-surface p-1.5',
            // The rail drops the pill container and stacks the links.
            'md:flex-col md:items-stretch md:gap-0.5 md:rounded-none md:border-0 md:bg-transparent md:p-0'
          )}
        >
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5',
                  'font-mono text-[0.62rem] font-medium tracking-[0.1em] uppercase transition-colors',
                  'md:flex-none md:justify-start md:gap-3 md:rounded-xl md:px-3 md:py-2.5 md:text-[0.7rem]',
                  isActive ? 'text-bg md:text-accent-ink' : 'text-ink-muted md:hover:text-ink'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    /* One element slides between tabs rather than four
                       cross-fading, which is what makes it read as a control. */
                    <motion.span
                      layoutId="dock-active"
                      className="absolute inset-0 rounded-full bg-accent md:rounded-xl md:bg-accent-solid"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <Icon size={14} strokeWidth={2} className="relative z-10 md:size-4" />
                  <span className="relative z-10">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>

        <span className="mt-auto hidden px-3 md:block">
          <span className="label">{profile?.role === 'teacher' ? 'Teacher' : 'Student'}</span>
        </span>
      </nav>

      {/*
        min-h-0 is load-bearing. A flex item defaults to min-height:auto, so
        without it this column refuses to shrink below its content, the main
        region never becomes the thing that scrolls, and the dock is pushed off
        the bottom of the viewport.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between px-5 pt-[max(0.9rem,env(safe-area-inset-top))] pb-3 md:px-8 md:pt-5 md:pb-4">
          <NavLink to="/" className="flex items-baseline gap-2" aria-label="Presently Campus, go home">
            <span className="font-mono text-[0.95rem] font-medium tracking-[-0.02em] text-ink">
              Presently
            </span>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="label">Campus</span>
          </NavLink>

          {online ? null : <OfflineFlag />}
        </header>

        <main ref={scrollRef} className="scroll-region min-h-0 flex-1 px-5 md:px-8">
          {/* Content stops widening well before the viewport does; a data row
              stretched across 1600px is unreadable. */}
          <div className="mx-auto w-full max-w-[30rem] md:max-w-[42rem] lg:max-w-[72rem]">
            {/*
              Screens swap instantly, as a native tab bar does; the sliding
              indicator is the motion. A cross-fade here made the old screen
              finish fading out before the new one could start, and rendered
              the new screen twice (the outgoing layer's Outlet already shows
              the new route). On a phone that was up to most of a second
              between the indicator moving and the screen appearing, long
              enough that people tapped again thinking the first tap missed.
            */}
            <Suspense fallback={<Booting />}>
              <Outlet />
            </Suspense>
            {/* Clears the dock so the last row is never trapped behind it. */}
            <div aria-hidden className="h-6 md:h-10" />
          </div>
        </main>
      </div>
    </div>
  )
}

/** Reading still works offline; scanning and marking do not. */
function OfflineFlag() {
  return (
    <span className="label flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1.5">
      <CircleSlash size={11} strokeWidth={2.2} />
      Offline
    </span>
  )
}

/** Screen title block: a small caps label above a large heading. */
export function ScreenHead({
  label,
  title,
  action
}: {
  label: string
  title: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 md:mb-8">
      <div className="min-w-0">
        <p className="label">{label}</p>
        <h1 className="readout mt-2.5 truncate text-[1.9rem] md:text-[2.3rem]">{title}</h1>
      </div>
      {action}
    </div>
  )
}
