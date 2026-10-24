import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Booting } from '../components/Booting'
import { PrivacyNotice } from '../components/PrivacyNotice'
import { useSession } from '../lib/session'
import { MAX_NAME_LENGTH, MAX_ROLL_LENGTH } from '../types'

/**
 * First sign-in: the details a roster needs. A student is listed by name and
 * roll number; a teacher only by name. The role itself was decided by the
 * server when the account was created.
 */
export function Onboarding() {
  const navigate = useNavigate()
  const { hydrated, userId, profile, profileError, saveProfile, signOut } = useSession()

  const [fullName, setFullName] = useState(profile?.fullName ?? '')
  const [rollNumber, setRollNumber] = useState(profile?.rollNumber ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!hydrated) return <Booting />
  if (!userId) return <Navigate to="/auth" replace />
  if (!profile) return <ProfileMissing message={profileError} onSignOut={() => void signOut()} />
  if (profile.onboarded) return <Navigate to="/" replace />

  const student = profile.role === 'student'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return

    const name = fullName.trim().replace(/\s+/g, ' ')
    const roll = rollNumber.replace(/\s+/g, '').toUpperCase()
    if (!name) {
      setError('Enter your full name.')
      return
    }
    if (student && !roll) {
      setError('Enter your roll number.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await saveProfile(student ? { fullName: name, rollNumber: roll } : { fullName: name })
      navigate('/', { replace: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save your details.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scroll-region h-full">
      <form
        onSubmit={submit}
        noValidate
        className="mx-auto flex min-h-full w-full max-w-[28rem] flex-col justify-center px-6"
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))'
        }}
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[0.9rem] tracking-[-0.02em]">Presently</span>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="label">{student ? 'Student' : 'Teacher'}</span>
        </div>

        <h1 className="mt-8 text-[1.6rem] leading-tight tracking-[-0.02em]">
          {student ? 'How your teachers see you' : 'How your students see you'}
        </h1>
        <p className="mt-3 text-[0.86rem] leading-relaxed text-ink-muted">
          {student
            ? 'Use your name and roll number exactly as they appear on the college register.'
            : 'Your name appears on each course you create.'}
        </p>

        <div className="mt-8 space-y-5">
          <div>
            <label className="label mb-2.5 block" htmlFor="onboard-name">
              Full name
            </label>
            <input
              id="onboard-name"
              className="field"
              autoComplete="name"
              maxLength={MAX_NAME_LENGTH}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>

          {student ? (
            <div>
              <label className="label mb-2.5 block" htmlFor="onboard-roll">
                Roll number
              </label>
              <input
                id="onboard-roll"
                className="field font-mono uppercase"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={MAX_ROLL_LENGTH}
                value={rollNumber}
                onChange={(event) => setRollNumber(event.target.value)}
              />
            </div>
          ) : null}

          <PrivacyNotice role={profile.role} />

          {error ? (
            <p
              role="alert"
              className="rounded-2xl border border-danger/30 bg-danger-wash px-4 py-3 text-[0.78rem] text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>

        <button type="submit" className="btn-primary mt-8 w-full" disabled={busy}>
          {busy ? (
            <Loader2 size={15} className="motion-safe:animate-spin" />
          ) : (
            <>
              Continue
              <ArrowRight size={14} strokeWidth={2.2} />
            </>
          )}
        </button>
      </form>
    </div>
  )
}

/** Shown when the profile could not be loaded and there is no cached copy. */
export function ProfileMissing({ message, onSignOut }: { message: string | null; onSignOut: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-[22rem] text-center">
        <h1 className="readout text-[1.3rem]">Could not load your account</h1>
        <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-muted">
          {message ?? 'Check your connection and try again.'}
        </p>
        <button type="button" className="btn-primary mt-7 w-full" onClick={() => window.location.reload()}>
          Try again
        </button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}
