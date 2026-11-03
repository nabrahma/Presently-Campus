import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, LogOut, Monitor, Moon, Smartphone, Sun, type LucideIcon } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ActionRow, DataRow, Panel, SectionHead } from '../components/Panel'
import { PrivacyNotice } from '../components/PrivacyNotice'
import { DevSwitch } from '../components/DevSwitch'
import { PhonePanel } from '../components/PhonePanel'
import { ScreenHead } from '../components/Shell'
import { setPassword } from '../lib/api'
import { useAppearance, type TextSize, type ThemeChoice } from '../lib/appearance'
import { usePhoneStatus } from '../lib/devices'
import { cn } from '../lib/cn'
import { useSession } from '../lib/session'
import { useInstallPrompt } from '../lib/useInstallPrompt'
import { MAX_NAME_LENGTH, MAX_ROLL_LENGTH, MIN_PASSWORD_LENGTH } from '../types'

export function Settings({ children }: { children?: ReactNode }) {
  const navigate = useNavigate()
  const { profile, email, saveProfile, signOut } = useSession()
  const { canInstall, installed, install } = useInstallPrompt()

  const student = profile?.role === 'student'
  const [fullName, setFullName] = useState(profile?.fullName ?? '')
  const [rollNumber, setRollNumber] = useState(profile?.rollNumber ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const name = fullName.trim().replace(/\s+/g, ' ')
  const roll = rollNumber.replace(/\s+/g, '').toUpperCase()
  const valid = name !== '' && (!student || roll !== '')
  const dirty = name !== profile?.fullName || (student && roll !== (profile?.rollNumber ?? ''))

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      await saveProfile(student ? { fullName: name, rollNumber: roll } : { fullName: name })
      toast.success('Saved')
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <ScreenHead label={email ?? 'Account'} title="Settings" />

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="space-y-5">
          <Panel className="p-5 md:p-6">
            <h2 className="title text-[1.25rem]">Your details</h2>
            <p className="mt-1 text-[1rem] text-ink-muted">
              {student ? 'As your teachers see you on the register.' : 'As your students see you on each course.'}
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-[1rem] font-medium" htmlFor="settings-name">
                  Full name
                </label>
                <input
                  id="settings-name"
                  className="field"
                  autoComplete="name"
                  maxLength={MAX_NAME_LENGTH}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>

              {student ? (
                <div>
                  <label className="mb-2 block text-[1rem] font-medium" htmlFor="settings-roll">
                    Roll number
                  </label>
                  <input
                    id="settings-roll"
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

              {!valid ? (
                <p role="alert" className="text-[1rem] text-danger">
                  {student ? 'Name and roll number are both needed.' : 'Your name is needed.'}
                </p>
              ) : null}

              <button
                type="button"
                className={cn('w-full', dirty && valid ? 'btn-primary' : 'btn-secondary')}
                disabled={!valid || !dirty || saving}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
          </Panel>

          <PasswordPanel email={email} />

          {children}

          {profile?.isDev ? <DeveloperPanel /> : null}

          <AppearancePanel />
        </div>

        <div className="mt-5 space-y-5 lg:mt-0">
          <Panel className="px-5 pt-4 pb-2 md:px-6">
            <SectionHead label="App" />

            {canInstall ? (
              <ActionRow
                icon={<Smartphone size={20} strokeWidth={1.9} />}
                title="Install app"
                detail={
                  student
                    ? 'Keeps this phone registered: browsers can clear sites that are not installed'
                    : 'Add to your home screen'
                }
                onClick={() => void install()}
              />
            ) : installed ? (
              <DataRow>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-good-wash text-good">
                  <Check size={20} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[1.0625rem] font-medium">Installed</p>
                  <p className="mt-0.5 text-[0.95rem] text-ink-muted">Running as an app</p>
                </div>
              </DataRow>
            ) : null}

            <ActionRow
              icon={<LogOut size={20} strokeWidth={1.9} />}
              title="Sign out"
              detail="Also clears this device's cached copy"
              onClick={() => setConfirmSignOut(true)}
            />
          </Panel>

          {profile ? <PrivacyNotice role={profile.role} /> : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        description={
          student
            ? 'Your attendance stays in your account, and this phone stays registered to you. The copy cached here is removed.'
            : 'Your courses stay in your account. The copy cached on this device is removed.'
        }
        confirmLabel="Sign out"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          await signOut()
          navigate('/auth', { replace: true })
        }}
      />
    </>
  )
}

/**
 * Adds a password to this account, or replaces it. Accounts made through a
 * sign-in link have none, so this is what lets a teacher sign in with email
 * and password instead of waiting for an email each time.
 */
function PasswordPanel({ email }: { email: string | null }) {
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const short = next.length > 0 && next.length < MIN_PASSWORD_LENGTH
  const mismatch = again.length > 0 && again !== next
  const ready = next.length >= MIN_PASSWORD_LENGTH && again === next

  const edit = (update: () => void) => {
    update()
    setError('')
    setSaved(false)
  }

  const save = async () => {
    if (!ready || saving) return
    setSaving(true)
    setError('')
    try {
      await setPassword(next)
      setNext('')
      setAgain('')
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel className="p-5 md:p-6">
      <h2 className="title text-[1.25rem]">Password</h2>
      <p className="mt-1 text-[1rem] leading-relaxed text-ink-muted">
        Sign in with your email and a password instead of waiting for an email link. This is the same account;
        nothing in it changes.
      </p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {/* Lets password managers file the new password under the right account. */}
        <input type="email" name="username" autoComplete="username" value={email ?? ''} readOnly hidden />
        <div>
          <label className="mb-2 block text-[1rem] font-medium" htmlFor="settings-password">
            New password
          </label>
          <input
            id="settings-password"
            className="field"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={next}
            onChange={(event) => edit(() => setNext(event.target.value))}
          />
        </div>
        <div>
          <label className="mb-2 block text-[1rem] font-medium" htmlFor="settings-password-again">
            Type it again
          </label>
          <input
            id="settings-password-again"
            className="field"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(event) => edit(() => setAgain(event.target.value))}
          />
        </div>

        {short || mismatch || error ? (
          <p role="alert" className="text-[1rem] text-danger">
            {error || (short ? `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.` : 'The two passwords do not match.')}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-[1rem] text-good">
            Password saved. Next time, sign in with {email ?? 'your email'} and this password.
          </p>
        ) : null}

        <button type="submit" className={cn('w-full', ready ? 'btn-primary' : 'btn-secondary')} disabled={!ready || saving}>
          {saving ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </Panel>
  )
}

const THEMES: Array<{ value: ThemeChoice; label: string; icon: LucideIcon }> = [
  { value: 'system', label: 'Automatic', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon }
]

const SIZES: Array<{ value: TextSize; label: string; sample: string }> = [
  { value: 'standard', label: 'Standard', sample: 'text-[1rem]' },
  { value: 'large', label: 'Large', sample: 'text-[1.15rem]' },
  { value: 'largest', label: 'Largest', sample: 'text-[1.3rem]' }
]

/** Light or dark, and how large the text reads. Saved on this device only. */
function AppearancePanel() {
  const [appearance, setAppearance] = useAppearance()

  return (
    <Panel className="p-5 md:p-6">
      <h2 className="title text-[1.25rem]">Appearance</h2>
      <p className="mt-1 text-[1rem] text-ink-muted">Saved on this device. Automatic follows the device’s own setting.</p>

      <p className="mt-5 mb-2 text-[1rem] font-medium" id="theme-label">
        Colours
      </p>
      <div role="radiogroup" aria-labelledby="theme-label" className="grid grid-cols-3 gap-2">
        {THEMES.map(({ value, label, icon: Icon }) => (
          <Choice key={value} selected={appearance.theme === value} onSelect={() => setAppearance({ theme: value })}>
            <Icon size={22} strokeWidth={1.9} />
            {label}
          </Choice>
        ))}
      </div>

      <p className="mt-5 mb-2 text-[1rem] font-medium" id="text-label">
        Text size
      </p>
      <div role="radiogroup" aria-labelledby="text-label" className="grid grid-cols-3 gap-2">
        {SIZES.map(({ value, label, sample }) => (
          <Choice key={value} selected={appearance.text === value} onSelect={() => setAppearance({ text: value })}>
            <span aria-hidden className={cn('grid h-7 place-items-center leading-none font-semibold', sample)}>
              Aa
            </span>
            {label}
          </Choice>
        ))}
      </div>
    </Panel>
  )
}

function Choice({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-22 flex-col items-center justify-center gap-2 rounded-2xl border-2 px-2 text-[0.95rem] font-medium transition-colors',
        selected ? 'border-ink bg-elevated text-ink' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

/** Only the developers see this: the switch, and what it does. */
function DeveloperPanel() {
  return (
    <Panel className="border-accent-bright/40 p-5 md:p-6">
      <div className="flex items-center gap-2.5">
        <h2 className="title text-[1.25rem]">Developer view</h2>
        <span className="chip bg-accent-wash text-accent">Dev</span>
      </div>
      <p className="mt-1 text-[1rem] leading-relaxed text-ink-muted">
        Switch your account between the teacher’s app and the student’s app. The server treats you exactly
        as one or the other, so you can join courses, register a phone and scan as a student, and run
        sessions as a teacher. The same switch is in the top bar.
      </p>
      <div className="mt-4">
        <DevSwitch />
      </div>
    </Panel>
  )
}

/** A student's settings carry this phone's registration. */
export function StudentSettings() {
  const { status } = usePhoneStatus()
  return (
    <Settings>
      <PhonePanel status={status} />
    </Settings>
  )
}
