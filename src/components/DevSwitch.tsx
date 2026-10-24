import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { GraduationCap, Presentation } from 'lucide-react'
import { cn } from '../lib/cn'
import { useSession } from '../lib/session'
import type { Role } from '../types'

const VIEWS: Array<{ role: Role; label: string; icon: typeof Presentation }> = [
  { role: 'teacher', label: 'Teacher', icon: Presentation },
  { role: 'student', label: 'Student', icon: GraduationCap }
]

/**
 * The developers' switch between the teacher's and the student's app. It
 * renders nothing for anyone else, and the server refuses the switch for
 * anyone not on the dev list, so hiding it is a courtesy, not the guard.
 */
export function DevSwitch({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate()
  const { profile, switchView } = useSession()
  const [busy, setBusy] = useState<Role | null>(null)

  if (!profile?.isDev) return null

  const choose = async (role: Role) => {
    if (busy || role === profile.role) return
    setBusy(role)
    try {
      await switchView(role)
      // The two views have different screens; start the new one from its home.
      navigate('/', { replace: true })
      toast.success(role === 'teacher' ? 'Viewing as a teacher' : 'Viewing as a student')
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Could not switch view.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Developer view"
      className={cn('inset flex shrink-0 items-center gap-1 rounded-full p-1', compact && 'p-0.5')}
    >
      {compact ? (
        <span className="hidden px-2 text-[0.8rem] font-semibold text-accent sm:inline" aria-hidden>
          Dev
        </span>
      ) : null}
      {VIEWS.map(({ role, label, icon: Icon }) => {
        const selected = profile.role === role
        return (
          <button
            key={role}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`View as ${label.toLowerCase()}`}
            disabled={busy !== null}
            onClick={() => void choose(role)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full font-semibold transition-colors disabled:opacity-60',
              compact ? 'min-h-10 px-3 text-[0.9rem]' : 'min-h-12 flex-1 px-4 text-[1rem]',
              selected ? 'bg-surface text-ink shadow-(--shadow-card)' : 'text-ink-muted hover:text-ink'
            )}
          >
            <Icon size={compact ? 16 : 18} strokeWidth={2} className={cn(compact && 'hidden sm:block')} />
            {busy === role ? 'Switching…' : label}
          </button>
        )
      })}
    </div>
  )
}
