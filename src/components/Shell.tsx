import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, matchPath, useLocation } from 'react-router-dom'
import { CalendarDays, CircleSlash, Clock3, House, Layers, Moon, Radio, ScanLine, Settings2, ShieldCheck, Sun, type LucideIcon } from 'lucide-react'
import { Avatar } from './Avatar'
import { Booting } from './Booting'
import { DevSwitch } from './DevSwitch'
import { Logo } from './Logo'
import { cn } from '../lib/cn'
import { setAppearance, useShownTheme } from '../lib/appearance'
import { useSession } from '../lib/session'
import type { Role } from '../types'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
  /** Deeper pages that belong to this section, for the breadcrumb and the highlight. */
  also?: string[]
}

/** Each role gets its own sections; the shell is otherwise the same for both. */
export const NAV: Record<Role, NavItem[]> = {
  student: [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/scan', label: 'Scan', icon: ScanLine, end: false },
    { to: '/courses', label: 'Courses', icon: Layers, end: false, also: ['/join/*'] },
    { to: '/settings', label: 'Settings', icon: Settings2, end: false }
  ],
  teacher: [
    { to: '/', label: 'Courses', icon: Layers, end: true, also: ['/courses/*', '/sessions/*'] },
    { to: '/live', label: 'Live', icon: Radio, end: true },
    { to: '/approvals', label: 'Approvals', icon: ShieldCheck, end: false },
    { to: '/settings', label: 'Settings', icon: Settings2, end: false }
  ]
}

function sectionOf(nav: NavItem[], pathname: string): NavItem | undefined {
  return nav.find(
    (item) =>
      matchPath({ path: item.to, end: item.end }, pathname) ||
      item.also?.some((pattern) => matchPath(pattern, pathname))
  )
}

/**
 * The persistent frame every screen renders into, laid out like the office
 * software people already know: a top bar with the date and the account, a
 * menu down the left with a word beside every icon, and the screen on a soft
 * grey page.
 *
 * Below `md` it is a phone: the top bar shrinks to the logo and the section,
 * and the same menu becomes a tab bar with a word under every icon. The menu
 * is a single element that restyles rather than a phone copy plus a desktop
 * copy, so there is only ever one set of links in the document.
 */
export function Shell() {
  const location = useLocation()
  const { online, profile } = useSession()
  const role = profile?.role ?? 'student'
  const nav = NAV[role]
  const section = sectionOf(nav, location.pathname)
  const scrollRef = useRef<HTMLElement>(null)

  // A persistent scroll container keeps its offset, so without this, arriving
  // at a new screen already scrolled halfway down is the default.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [location.pathname])

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <header
        className={cn(
          'flex shrink-0 items-center gap-3 border-b border-line bg-surface',
          'px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:h-[4.75rem] md:gap-5 md:px-6 md:py-0'
        )}
      >
        <NavLink to="/" className="flex min-w-0 items-center gap-3 md:w-[13.75rem] md:shrink-0" aria-label="Presently Campus, go home">
          <Logo className="size-10 md:size-11" />
          <span className="hidden min-w-0 md:block">
            <span className="title block text-[1.075rem]">Presently</span>
            <span className="block text-[0.85rem] font-medium text-ink-muted">Campus attendance</span>
          </span>
        </NavLink>

        <p className="title min-w-0 flex-1 truncate text-[1.125rem] md:hidden">{section?.label ?? 'Presently'}</p>

        <span aria-hidden className="hidden h-10 w-px bg-line md:block" />
        <Today />

        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
          {online ? null : <OfflineFlag />}
          <DevSwitch compact />
          <ThemeToggle />
          <AccountChip name={profile?.fullName ?? ''} role={role} dev={profile?.isDev ?? false} />
        </div>
      </header>

      {/*
        min-h-0 is load-bearing. A flex item defaults to min-height:auto, so
        without it this row refuses to shrink below its content, the main
        region never becomes the thing that scrolls, and the tab bar is pushed
        off the bottom of the viewport.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <aside
          className={cn(
            // Phone: a tab bar pinned under the content.
            'order-last shrink-0 border-t border-line bg-surface px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
            // Desktop: a labelled menu down the left.
            'md:order-first md:flex md:w-[15.75rem] md:flex-col md:border-t-0 md:border-r md:px-3.5 md:pt-6 md:pb-5'
          )}
        >
          <p className="mb-2 hidden px-3 text-[0.85rem] font-semibold text-ink-faint md:block">Menu</p>
          <nav aria-label="Sections" className="flex md:flex-col md:gap-1">
            {nav.map((item) => (
              <SectionLink key={item.to} item={item} active={section?.to === item.to} />
            ))}
          </nav>

          <div className="mt-auto hidden md:block">
            <ClockTile />
          </div>
        </aside>

        <main ref={scrollRef} className="scroll-region min-h-0 flex-1 px-4 pt-5 md:px-8 md:pt-6">
          {/* Content stops widening well before the viewport does; a row of
              figures stretched across 1600px is unreadable. */}
          <div className="mx-auto w-full max-w-[34rem] md:max-w-[52rem] lg:max-w-[80rem]">
            <Suspense fallback={<Booting />}>
              <Outlet />
            </Suspense>
            <div aria-hidden className="h-8 md:h-12" />
          </div>
        </main>
      </div>
    </div>
  )
}

/** A tab under a phone screen; a row in the menu on a wider one. */
function SectionLink({ item, active }: { item: NavItem; active: boolean }) {
  const { to, label, icon: Icon, end } = item
  return (
    <NavLink
      to={to}
      end={end}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[0.85rem] font-semibold transition-colors',
        'md:min-h-13 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3 md:text-[1.0625rem]',
        active ? 'text-accent md:bg-accent-wash' : 'text-ink-muted md:hover:bg-elevated md:hover:text-ink'
      )}
    >
      {/* The bar at the left edge marks the current section on a wide screen. */}
      {active ? <span aria-hidden className="absolute top-3 bottom-3 -left-3.5 hidden w-1 rounded-r-full bg-accent-solid md:block" /> : null}
      <span
        className={cn(
          'grid h-8 w-14 shrink-0 place-items-center rounded-full transition-colors md:size-6 md:rounded-none',
          active ? 'bg-accent-wash md:bg-transparent' : ''
        )}
      >
        <Icon size={21} strokeWidth={active ? 2.3 : 2} />
      </span>
      {label}
    </NavLink>
  )
}

/** Re-renders on the minute, so the date and clock are never stale. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let interval: number | undefined
    const timeout = window.setTimeout(() => {
      setNow(new Date())
      interval = window.setInterval(() => setNow(new Date()), 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      window.clearTimeout(timeout)
      if (interval) window.clearInterval(interval)
    }
  }, [])
  return now
}

/** Today's date in the top bar, as a register would head its page. */
function Today() {
  const now = useMinute()
  return (
    <div className="hidden min-w-0 items-center gap-3 md:flex">
      <span className="icon-tile size-10">
        <CalendarDays size={19} strokeWidth={2.1} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.85rem] font-medium text-ink-muted">Today</p>
        <p className="truncate text-[1.0625rem] font-bold">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>
    </div>
  )
}

/** The time at the foot of the menu, for a teacher keeping an eye on the hour. */
function ClockTile() {
  const now = useMinute()
  return (
    <div className="inset flex items-center gap-3 px-3.5 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-accent shadow-(--shadow-card)">
        <Clock3 size={19} strokeWidth={2.1} />
      </span>
      <div>
        <p className="readout text-[1.25rem]">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</p>
        <p className="mt-1 text-[0.85rem] font-medium text-ink-muted">{now.toLocaleDateString(undefined, { weekday: 'long' })}</p>
      </div>
    </div>
  )
}

/** One tap between light and dark; Settings has the full choice. */
function ThemeToggle() {
  const shown = useShownTheme()
  const next = shown === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => setAppearance({ theme: next })}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="grid size-11 place-items-center rounded-xl border border-line text-ink transition-colors hover:bg-elevated"
    >
      {shown === 'dark' ? <Sun size={20} strokeWidth={2} /> : <Moon size={20} strokeWidth={2} />}
    </button>
  )
}

/** Who is signed in, top right, as in every office app; it opens Settings. */
function AccountChip({ name, role, dev }: { name: string; role: Role; dev: boolean }) {
  return (
    <NavLink
      to="/settings"
      className="hidden items-center gap-3 rounded-xl border border-line py-1.5 pr-4 pl-1.5 transition-colors hover:bg-elevated md:flex"
    >
      <Avatar name={name || '?'} className="size-9 text-[0.85rem]" />
      <span className="min-w-0 max-w-[12rem]">
        <span className="block truncate text-[0.95rem] leading-tight font-semibold">{name || 'Your account'}</span>
        <span className="block text-[0.825rem] text-ink-muted">
          {dev ? `Dev · ${role} view` : role === 'teacher' ? 'Teacher' : 'Student'}
        </span>
      </span>
    </NavLink>
  )
}

/** Reading still works offline; scanning and marking do not. */
function OfflineFlag() {
  return (
    <span className="chip bg-warn-wash text-warn">
      <CircleSlash size={15} strokeWidth={2.2} />
      Offline
    </span>
  )
}

/**
 * Screen title block: the title, a line of context under it, and an optional
 * icon tile beside it.
 */
export function ScreenHead({
  label,
  title,
  icon,
  action
}: {
  label: string
  title: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 md:mb-7">
      <div className="flex min-w-0 items-center gap-4">
        {icon ? <span className="icon-tile size-14 rounded-2xl md:size-16">{icon}</span> : null}
        <div className="min-w-0">
          {/* Wrapped, not truncated: a cut-off course name or join code
              helps nobody. */}
          <h1 className="title text-[1.75rem] break-words md:text-[2rem]">{title}</h1>
          <p className="mt-1 text-[1.0625rem] text-ink-muted">{label}</p>
        </div>
      </div>
      {action}
    </div>
  )
}
