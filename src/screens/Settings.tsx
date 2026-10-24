import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, LogOut, Smartphone } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DataRow, Panel, SectionHead } from '../components/Panel'
import { PrivacyNotice } from '../components/PrivacyNotice'
import { ScreenHead } from '../components/Shell'
import { cn } from '../lib/cn'
import { useSession } from '../lib/session'
import { useInstallPrompt } from '../lib/useInstallPrompt'
import { MAX_NAME_LENGTH, MAX_ROLL_LENGTH } from '../types'

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

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        <div className="space-y-7">
          <Panel className="px-5 py-5">
            <p className="label mb-4">{student ? 'Student' : 'Teacher'}</p>

            <div className="space-y-4">
              <div>
                <label className="label mb-2.5 block" htmlFor="settings-name">
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
                  <label className="label mb-2.5 block" htmlFor="settings-roll">
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
                <p role="alert" className="text-[0.75rem] text-danger">
                  {student ? 'Name and roll number are both needed.' : 'Your name is needed.'}
                </p>
              ) : null}

              <button
                type="button"
                className={cn('w-full', dirty && valid ? 'btn-primary' : 'btn-secondary')}
                disabled={!valid || !dirty || saving}
                onClick={() => void save()}
              >
                {saving ? 'Saving' : dirty ? 'Save' : 'Saved'}
              </button>
            </div>
          </Panel>

          {children}
        </div>

        <div className="mt-7 space-y-7 lg:mt-0">
          <div>
            <SectionHead label="App" />

            {canInstall ? (
              <ActionRow
                icon={<Smartphone size={16} strokeWidth={1.9} />}
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
                <span className="shrink-0 text-accent">
                  <Check size={16} strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.85rem]">Installed</p>
                  <p className="label mt-1.5">Running as an app</p>
                </div>
              </DataRow>
            ) : null}

            <ActionRow
              icon={<LogOut size={16} strokeWidth={1.9} />}
              title="Sign out"
              detail="Also clears this device's cached copy"
              onClick={() => setConfirmSignOut(true)}
            />
          </div>

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

export function ActionRow({
  icon,
  title,
  detail,
  onClick,
  destructive = false
}: {
  icon: ReactNode
  title: string
  detail: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <DataRow onClick={onClick} className="py-4">
      <span className={cn('shrink-0', destructive ? 'text-danger' : 'text-ink-muted')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[0.85rem]', destructive && 'text-danger')}>{title}</span>
        <span className="label mt-1.5 block normal-case">{detail}</span>
      </span>
    </DataRow>
  )
}
