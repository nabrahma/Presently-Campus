import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Smartphone } from 'lucide-react'
import { Panel } from './Panel'
import { cn } from '../lib/cn'
import { formatSessionTime } from '../lib/date'
import { forgetDeviceKey } from '../lib/deviceKey'
import { registerThisPhone, type PhoneStatus } from '../lib/devices'
import { useUserId } from '../lib/session'

interface Copy {
  label: string
  tone: 'accent' | 'warn' | 'danger' | 'muted'
  text: string
  action?: string
}

/** What to tell a student about this phone, and what they can do next. */
export function describePhone(status: PhoneStatus): Copy {
  switch (status.kind) {
    case 'unsupported':
      return {
        label: 'Not supported',
        tone: 'danger',
        text: 'This browser cannot keep a device key, so it cannot mark attendance. Turn off private browsing, or use your phone’s main browser.'
      }
    case 'unregistered':
      return status.elsewhere
        ? {
            label: 'Another phone is registered',
            tone: 'warn',
            text: `Your attendance is marked from the phone you registered on ${formatSessionTime(status.elsewhere.createdAt)}. To use this one instead, request a device change; a teacher approves it and the old phone stops working.`,
            action: 'Request device change'
          }
        : {
            label: 'Not registered',
            tone: 'warn',
            text: 'Register the phone you will scan with. Only that phone can mark your attendance.',
            action: 'Register this phone'
          }
    case 'other-account':
      return {
        label: 'Someone else’s phone',
        tone: 'danger',
        text: 'This phone is registered to another account, so it cannot mark attendance for you. Each phone belongs to one student.'
      }
    case 'revoked':
      return {
        label: 'Retired',
        tone: 'danger',
        text: 'This phone was replaced or rejected. Register it again to request it back.',
        action: 'Register again'
      }
    case 'pending':
      return {
        label: 'Waiting for approval',
        tone: 'warn',
        text: `Requested ${formatSessionTime(status.device.createdAt)}. A teacher of one of your courses needs to approve it. Until then, ${status.elsewhere ? 'your old phone still works' : 'this phone cannot mark attendance'}.`
      }
    case 'cooling':
      return {
        label: 'Cooling off',
        tone: 'warn',
        text: `New phones can mark attendance from ${formatSessionTime(status.until)}, or sooner if a teacher approves this one. It cannot mark a class that started before it was registered.`
      }
    case 'active':
      return {
        label: 'Registered',
        tone: 'accent',
        text: `This phone marks your attendance. Registered ${formatSessionTime(status.device.createdAt)}.`
      }
  }
}

const TONE: Record<Copy['tone'], string> = {
  accent: 'text-accent',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-ink-muted'
}

export function PhonePanel({ status, className }: { status: PhoneStatus | null; className?: string }) {
  const userId = useUserId()
  const [busy, setBusy] = useState(false)

  if (!status) {
    return (
      <Panel className={cn('px-5 py-5', className)}>
        <p className="label">This phone</p>
        <p className="mt-3 text-[0.8rem] text-ink-muted">Checking…</p>
      </Panel>
    )
  }

  const copy = describePhone(status)

  const act = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (status.kind === 'revoked') await forgetDeviceKey()
      const result = await registerThisPhone(userId)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Could not register this phone.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className={cn('px-5 py-5', className)}>
      <div className="flex items-center gap-2">
        <Smartphone size={14} strokeWidth={2} className={TONE[copy.tone]} />
        <p className="label">This phone</p>
        <p className={cn('label ml-auto', TONE[copy.tone])}>{copy.label}</p>
      </div>
      <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-muted">{copy.text}</p>
      {copy.action ? (
        <button type="button" className="btn-primary mt-5 w-full" disabled={busy} onClick={() => void act()}>
          {busy ? <Loader2 size={15} className="motion-safe:animate-spin" /> : copy.action}
        </button>
      ) : null}
    </Panel>
  )
}
