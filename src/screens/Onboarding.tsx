import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Loader2, Smartphone } from 'lucide-react'
import { Booting } from '../components/Booting'
import { Frame } from '../components/Frame'
import { Logo } from '../components/Logo'
import { PrivacyNotice } from '../components/PrivacyNotice'
import { registerThisPhone } from '../lib/devices'
import { useSession } from '../lib/session'
import { MAX_NAME_LENGTH, MAX_ROLL_LENGTH } from '../types'

/**
 * First sign-in: the details a roster needs, then, for a student, this phone.
 * A student is listed by name and roll number; a teacher only by name. The
 * role itself was decided by the server when the account was created.
 */
export function Onboarding() {
  const navigate = useNavigate()
  const { hydrated, userId, profile, profileError, saveProfile, signOut } = useSession()

  const [fullName, setFullName] = useState(profile?.fullName ?? '')
  const [rollNumber, setRollNumber] = useState(profile?.rollNumber ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Saving the details marks the profile onboarded, which would otherwise
  // send the student straight past the phone step.
  const [registering, setRegistering] = useState(false)

  if (!hydrated) return <Booting />
  if (!userId) return <Navigate to="/auth" replace />
  if (!profile) return <ProfileMissing message={profileError} onSignOut={() => void signOut()} />
  if (registering) return <RegisterPhone userId={userId} onDone={() => navigate('/', { replace: true })} />
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
      if (student) setRegistering(true)
      else navigate('/', { replace: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save your details.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame>
      <form onSubmit={submit} noValidate>
        <div className="flex items-center gap-3">
          <Logo className="size-12" />
          <div>
            <p className="title text-[1.125rem]">Presently</p>
            <p className="text-[0.95rem] text-ink-muted">{student ? 'Student account' : 'Teacher account'}</p>
          </div>
        </div>

        <Steps current={1} total={student ? 2 : 1} />

        <h1 className="title mt-3 text-[2rem]">
          {student ? 'How your teachers see you' : 'How your students see you'}
        </h1>
        <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-muted">
          {student
            ? 'Use your name and roll number exactly as they appear on the college register.'
            : 'Your name appears on each course you create.'}
        </p>

        <div className="mt-8 space-y-5">
          <div>
            <label className="mb-2 block text-[1rem] font-medium" htmlFor="onboard-name">
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
              <label className="mb-2 block text-[1rem] font-medium" htmlFor="onboard-roll">
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
              className="rounded-2xl border border-danger/30 bg-danger-wash px-4 py-3 text-[1rem] text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>

        <button type="submit" className="btn-primary mt-8 w-full" disabled={busy}>
          {busy ? (
            <Loader2 size={20} className="motion-safe:animate-spin" />
          ) : (
            <>
              Continue
              <ArrowRight size={18} strokeWidth={2.2} />
            </>
          )}
        </button>
      </form>
    </Frame>
  )
}

/** "Step 1 of 2", in words and as a bar, so setup never feels open-ended. */
function Steps({ current, total }: { current: number; total: number }) {
  if (total < 2) return <div className="mt-9" />
  return (
    <div className="mt-9">
      <p className="text-[0.95rem] font-medium text-ink-muted">
        Step {current} of {total}
      </p>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={index < current ? 'h-1.5 flex-1 rounded-full bg-accent-bright' : 'h-1.5 flex-1 rounded-full bg-line'} />
        ))}
      </div>
    </div>
  )
}

/**
 * The second step for a student: bind this phone to the account. It is
 * deliberate rather than automatic, because the first device registered is
 * the one that marks attendance, and that should be the phone, not a laptop.
 */
function RegisterPhone({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)

  const register = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await registerThisPhone(userId)
      setOutcome({ ok: result.ok, message: result.message })
    } catch (failure) {
      setOutcome({ ok: false, message: failure instanceof Error ? failure.message : 'Could not register this phone.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame>
      <Steps current={2} total={2} />

      <div
        className={
          outcome?.ok
            ? 'mt-7 grid size-16 place-items-center rounded-2xl bg-good-wash text-good'
            : 'mt-7 grid size-16 place-items-center rounded-2xl bg-accent-wash text-accent'
        }
      >
        {outcome?.ok ? <Check size={30} strokeWidth={2} /> : <Smartphone size={30} strokeWidth={1.8} />}
      </div>

      <h1 className="title mt-6 text-[2rem]">
        {outcome?.ok ? 'This phone is yours' : 'Register this phone'}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-muted">
        {outcome
          ? outcome.message
          : 'Attendance can only be marked from one phone, and this registers it. Do this on the phone you will scan with. A new phone can mark attendance after 12 hours, or sooner if a teacher approves it.'}
      </p>

      {outcome && !outcome.ok ? null : outcome ? (
        <button type="button" className="btn-primary mt-8 w-full" onClick={onDone}>
          Continue
          <ArrowRight size={18} strokeWidth={2.2} />
        </button>
      ) : (
        <button type="button" className="btn-primary mt-8 w-full" disabled={busy} onClick={() => void register()}>
          {busy ? <Loader2 size={20} className="motion-safe:animate-spin" /> : 'Register this phone'}
        </button>
      )}

      {outcome && !outcome.ok ? (
        <button type="button" className="btn-primary mt-8 w-full" disabled={busy} onClick={() => void register()}>
          Try again
        </button>
      ) : null}

      {outcome?.ok ? null : (
        <button type="button" className="btn-secondary mt-3 w-full" onClick={onDone}>
          Not on my phone · do it later
        </button>
      )}
    </Frame>
  )
}

/** Shown when the profile could not be loaded and there is no cached copy. */
export function ProfileMissing({ message, onSignOut }: { message: string | null; onSignOut: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-[26rem] text-center">
        <h1 className="title text-[1.75rem]">Could not load your account</h1>
        <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-muted">
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
