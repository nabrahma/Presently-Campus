import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, BarChart3, Loader2, MailCheck, QrCode, ScanLine } from 'lucide-react'
import { Booting } from '../components/Booting'
import { Frame } from '../components/Frame'
import { Logo } from '../components/Logo'
import { cn } from '../lib/cn'
import { useSession } from '../lib/session'
import { describeError, supabase } from '../lib/supabaseClient'

type Mode = 'signIn' | 'signUp'
type Method = 'link' | 'password'

const RESEND_SECONDS = 45

export function Auth() {
  const navigate = useNavigate()
  const { userId, hydrated, profile, cloud } = useSession()

  const [mode, setMode] = useState<Mode>('signIn')
  const [method, setMethod] = useState<Method>('link')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    timerRef.current = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [cooldown])

  if (!hydrated) return <Booting />
  if (userId) return <Navigate to={profile?.onboarded ? '/' : '/onboarding'} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return

    const address = email.trim().toLowerCase()
    if (!address) {
      setError('Enter your email address.')
      return
    }
    if (!supabase) {
      setError('This build has no Supabase credentials, so accounts are unavailable.')
      return
    }
    if (method === 'password' && password.length < 6) {
      setError('Passwords need at least 6 characters.')
      return
    }

    setBusy(true)
    setError('')

    try {
      // Links must return to this exact origin, or the session is created
      // somewhere the person is not.
      const emailRedirectTo = `${window.location.origin}/`

      if (method === 'link') {
        const { error: failure } = await supabase.auth.signInWithOtp({
          email: address,
          options: { emailRedirectTo, shouldCreateUser: true }
        })
        if (failure) throw failure
        setSentTo(address)
        setCooldown(RESEND_SECONDS)
      } else if (mode === 'signUp') {
        const { data, error: failure } = await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo }
        })
        if (failure) throw failure

        // Supabase returns a user with no identities for an address that is
        // already taken, rather than an error.
        if (data.user && data.user.identities?.length === 0) {
          setError('That email already has an account. Sign in instead.')
          setMode('signIn')
          return
        }
        if (!data.session) {
          setSentTo(address)
          setCooldown(RESEND_SECONDS)
          return
        }
        navigate('/onboarding', { replace: true })
      } else {
        const { error: failure } = await supabase.auth.signInWithPassword({
          email: address,
          password
        })
        if (failure) throw failure
        navigate('/', { replace: true })
      }
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <Frame>
        <div className="grid size-16 place-items-center rounded-2xl bg-good-wash text-good">
          <MailCheck size={30} strokeWidth={1.8} />
        </div>
        <h1 className="title mt-7 text-[2rem]">Check your email</h1>
        <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-muted">
          We sent a sign-in link to <span className="font-semibold text-ink">{sentTo}</span>. Open the
          email on this device and tap the link to continue.
        </p>
        <button
          type="button"
          className="btn-secondary mt-8 w-full"
          disabled={cooldown > 0 || busy}
          onClick={() => {
            setSentTo('')
            setEmail(sentTo)
          }}
        >
          {cooldown > 0 ? `You can try again in ${cooldown} seconds` : 'Use a different email'}
        </button>
      </Frame>
    )
  }

  return (
    <Frame aside={<HowItWorks />}>
      <div className="flex items-center gap-3">
        <Logo className="size-12" />
        <div>
          <p className="title text-[1.125rem]">Presently</p>
          <p className="text-[0.95rem] text-ink-muted">Campus attendance</p>
        </div>
      </div>

      <h1 className="title mt-9 text-[2rem] md:text-[2.25rem]">
        {mode === 'signIn' ? 'Welcome back' : 'Create your account'}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-muted">
        Sign in with your college email. Teachers are recognised automatically.
      </p>

      {cloud ? (
        <>
          <div role="tablist" aria-label="Account action" className="inset mt-8 flex gap-1 rounded-full p-1.5">
            {(
              [
                ['signIn', 'Sign in'],
                ['signUp', 'Create account']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={mode === key}
                onClick={() => {
                  setMode(key)
                  setError('')
                }}
                className={cn(
                  'min-h-12 flex-1 rounded-full px-4 text-[1rem] font-semibold transition-colors',
                  mode === key ? 'bg-surface text-ink shadow-(--shadow-card)' : 'text-ink-muted hover:text-ink'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} noValidate className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-[1rem] font-medium" htmlFor="auth-email">
                College email
              </label>
              <input
                id="auth-email"
                className="field"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                placeholder="you@college.edu"
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (error) setError('')
                }}
              />
            </div>

            {method === 'password' ? (
              <div>
                <label className="mb-2 block text-[1rem] font-medium" htmlFor="auth-password">
                  Password
                </label>
                <input
                  id="auth-password"
                  className="field"
                  type="password"
                  minLength={6}
                  autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  placeholder="At least 6 characters"
                  onChange={(event) => {
                    setPassword(event.target.value)
                    if (error) setError('')
                  }}
                />
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-2xl border border-danger/30 bg-danger-wash px-4 py-3 text-[1rem] text-danger">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? (
                <Loader2 size={20} className="motion-safe:animate-spin" />
              ) : (
                <>
                  {method === 'link' ? 'Send link' : mode === 'signUp' ? 'Create account' : 'Sign in'}
                  <ArrowRight size={18} strokeWidth={2.2} />
                </>
              )}
            </button>
          </form>

          <button
            type="button"
            className="mx-auto mt-3 flex min-h-12 items-center px-3 text-[1rem] font-medium underline decoration-line-strong underline-offset-4 hover:decoration-ink"
            onClick={() => {
              setMethod(method === 'link' ? 'password' : 'link')
              setError('')
            }}
          >
            {method === 'link' ? 'Use a password' : 'Email me a link'}
          </button>
        </>
      ) : (
        <p className="inset mt-8 px-5 py-4 text-[1rem] leading-relaxed text-ink-muted">
          This build has no Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the
          Presently Campus project and rebuild.
        </p>
      )}

      <p className="mt-6 text-center text-[0.95rem] text-ink-muted">One account per student · one phone per account</p>
    </Frame>
  )
}

const STEPS = [
  {
    icon: QrCode,
    title: 'The teacher shows a code',
    text: 'It changes every ten seconds, so a photo sent to a friend outside is useless.'
  },
  {
    icon: ScanLine,
    title: 'Students scan it',
    text: 'From their own registered phone, inside this app. Marked in about a second.'
  },
  {
    icon: BarChart3,
    title: 'Everyone sees where they stand',
    text: 'Each subject’s percentage, and how many classes can still be missed.'
  }
]

/** The wide-screen companion to the sign-in form: what the app does, in three steps. */
function HowItWorks() {
  return (
    <div className="dot-grid flex h-full flex-col justify-center rounded-[1.75rem] border border-line bg-elevated/60 p-10">
      <p className="chip w-fit bg-warn-wash text-warn">How it works</p>
      <h2 className="title mt-5 text-[1.75rem]">Attendance in one scan</h2>
      <ol className="mt-8 space-y-4">
        {STEPS.map(({ icon: Icon, title, text }, index) => (
          <li key={title} className="panel flex gap-4 p-5">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ink text-surface">
              <Icon size={22} strokeWidth={2} />
            </span>
            <span>
              <span className="block text-[1.0625rem] font-semibold">
                {index + 1}. {title}
              </span>
              <span className="mt-1 block text-[1rem] leading-relaxed text-ink-muted">{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
