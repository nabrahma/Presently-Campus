import { Suspense, useEffect, useRef, type ReactNode } from 'react'
import { NavLink, Outlet, matchPath, useLocation } from 'react-router-dom'
import { CircleSlash, House, Layers, Moon, Radio, ScanLine, Settings2, ShieldCheck, Sun, type LucideIcon } from 'lucide-react'
import { Booting } from './Booting'
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
 * The persistent frame every screen renders into.
 *
 * Below `md` it is a phone: a header, one column and a tab bar with a word
 * under every icon. From `md` the same links become a labelled sidebar and the
 * screen sits in a white frame on the grey page, as in a desktop app.
 *
 * The navigation is a single element that restyles rather than a phone copy
 * plus a desktop copy, so there is only ever one set of links in the document.
 *
 * Every icon carries its name. Icons alone are guesses for anyone who has not
 * learnt them, and the people using this have better things to learn.
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
    <div className="flex h-full w-full flex-col bg-surface md:flex-row md:bg-bg">
      <aside
        className={cn(
          // Phone: a tab bar pinned under the content.
          'order-last shrink-0 border-t border-line bg-surface px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          // Desktop: a labelled sidebar on the grey page.
          'md:order-first md:flex md:w-[16rem] md:flex-col md:border-0 md:bg-transparent md:px-4 md:py-6 lg:w-[17.5rem]'
        )}
      >
        <NavLink to="/" className="hidden items-center gap-3 px-2 md:flex" aria-label="Presently Campus, go home">
          <Logo className="size-11" />
          <span className="min-w-0">
            <span className="title block text-[1.05rem]">Presently</span>
            <span className="block text-[0.85rem] text-ink-muted">Campus attendance</span>
          </span>
        </NavLink>

        <div aria-hidden className="mx-2 mt-6 mb-4 hidden h-px bg-line-strong/70 md:block" />

        <nav aria-label="Sections" className="flex md:flex-col md:gap-1.5">
          {nav.map((item) => (
            <SectionLink key={item.to} item={item} active={section?.to === item.to} />
          ))}
        </nav>

        <div className="mt-auto hidden md:block">
          <AccountCard name={profile?.fullName ?? ''} role={role} />
        </div>
      </aside>

      {/*
        min-h-0 is load-bearing. A flex item defaults to min-height:auto, so
        without it this column refuses to shrink below its content, the main
        region never becomes the thing that scrolls, and the tab bar is pushed
        off the bottom of the viewport.
      */}
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col',
          'md:my-3 md:mr-3 md:overflow-hidden md:rounded-[2rem] md:border md:border-line md:bg-surface md:shadow-(--shadow-card)'
        )}
      >
        <header
          className={cn(
            'flex shrink-0 items-center justify-between gap-3 border-b border-line',
            'px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:px-8 md:py-4'
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <NavLink to="/" className="md:hidden" aria-label="Presently Campus, go home">
              <Logo className="size-10" />
            </NavLink>
            <Breadcrumb section={section} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {online ? null : <OfflineFlag />}
            <ThemeToggle />
          </div>
        </header>

        <main ref={scrollRef} className="scroll-region min-h-0 flex-1 px-4 pt-5 md:px-8 md:pt-8">
          {/* Content stops widening well before the viewport does; a row of
              figures stretched across 1600px is unreadable. */}
          <div className="mx-auto w-full max-w-[34rem] md:max-w-[46rem] lg:max-w-[76rem]">
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

/** A tab under a phone screen; a row in the sidebar on a wider one. */
function SectionLink({ item, active }: { item: NavItem; active: boolean }) {
  const { to, label, icon: Icon, end } = item
  return (
    <NavLink
      to={to}
      end={end}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[0.85rem] font-medium transition-colors',
        'md:min-h-14 md:flex-none md:flex-row md:justify-start md:gap-3.5 md:px-2.5 md:text-[1.0625rem]',
        active
          ? 'text-ink md:bg-surface md:shadow-(--shadow-card)'
          : 'text-ink-muted md:hover:bg-surface/60 md:hover:text-ink'
      )}
    >
      <span
        className={cn(
          'grid h-8 w-14 shrink-0 place-items-center rounded-full transition-colors md:size-10 md:rounded-xl',
          active ? 'bg-ink text-surface' : 'text-ink-muted'
        )}
      >
        <Icon size={20} strokeWidth={2} />
      </span>
      {label}
    </NavLink>
  )
}

/** "Presently / Courses": where you are, in words. */
function Breadcrumb({ section }: { section: NavItem | undefined }) {
  const Icon = section?.icon ?? House
  return (
    <p className="flex min-w-0 items-center gap-2 text-[1.0625rem]">
      <span className="hidden size-8 shrink-0 place-items-center rounded-lg bg-elevated text-ink-muted md:grid">
        <Icon size={17} strokeWidth={2} />
      </span>
      <span className="hidden text-ink-muted sm:inline">Presently</span>
      <span aria-hidden className="hidden text-ink-faint sm:inline">
        /
      </span>
      <span className="title truncate">{section?.label ?? 'Presently'}</span>
    </p>
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
      className="grid size-12 place-items-center rounded-full border border-line text-ink transition-colors hover:bg-elevated"
    >
      {shown === 'dark' ? <Sun size={20} strokeWidth={2} /> : <Moon size={20} strokeWidth={2} />}
    </button>
  )
}

function AccountCard({ name, role }: { name: string; role: Role }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'

  return (
    <NavLink
      to="/settings"
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3 transition-colors hover:border-line-strong"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-wash text-[0.95rem] font-semibold text-accent">
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.95rem] font-semibold">{name || 'Your account'}</span>
        <span className="block text-[0.85rem] text-ink-muted">{role === 'teacher' ? 'Teacher' : 'Student'}</span>
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
 * icon tile beside it, as at the top of the reference layout.
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
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 md:mb-8">
      <div className="flex min-w-0 items-center gap-4">
        {icon ? (
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-bright text-white md:size-16">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          {/* Wrapped, not truncated: a cut-off course name or join code
              helps nobody. */}
          <h1 className="title text-[1.75rem] break-words md:text-[2.125rem]">{title}</h1>
          <p className="mt-1 text-[1.0625rem] text-ink-muted md:text-[1.125rem]">{label}</p>
        </div>
      </div>
      {action}
    </div>
  )
}
