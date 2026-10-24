import { useState } from 'react'
import { toast } from 'sonner'
import { Clock, ShieldCheck, Smartphone } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { Panel, SectionHead } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { formatSessionTime } from '../../lib/date'
import { useUserId } from '../../lib/session'
import { decidePhone, usePhoneRequests, type PhoneRequest } from '../../lib/teacher'

/**
 * A short, readable name for a browser's user agent: enough to tell "an
 * iPhone" from "a Windows laptop" when deciding whether a request is genuine.
 */
export function describeAgent(agent: string | null): string {
  if (!agent) return 'Unknown device'
  const platform = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Windows/.test(agent)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(agent)
            ? 'Mac'
            : /Linux/.test(agent)
              ? 'Linux'
              : 'Unknown device'
  const browser = /EdgA?\//.test(agent)
    ? 'Edge'
    : /SamsungBrowser/.test(agent)
      ? 'Samsung Internet'
      : /CriOS|Chrome\//.test(agent)
        ? 'Chrome'
        : /FxiOS|Firefox\//.test(agent)
          ? 'Firefox'
          : /Safari\//.test(agent)
            ? 'Safari'
            : null
  return browser ? `${platform} · ${browser}` : platform
}

export function TeacherApprovals() {
  const userId = useUserId()
  const { data, error, refresh } = usePhoneRequests()
  const [rejecting, setRejecting] = useState<PhoneRequest | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />

  const changes = data.filter((request) => request.kind === 'change')
  const first = data.filter((request) => request.kind === 'first')

  const decide = async (request: PhoneRequest, approve: boolean) => {
    setBusy(request.deviceId)
    try {
      await decidePhone(userId, request.deviceId, approve)
      toast.success(approve ? `${request.fullName}'s phone approved` : `${request.fullName}'s phone rejected`)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <ScreenHead
        label={data.length === 0 ? 'Nothing waiting' : `${data.length} waiting`}
        title="Approvals"
        icon={<ShieldCheck size={26} strokeWidth={2} />}
      />

      {data.length === 0 ? (
        <Empty
          icon={<ShieldCheck size={26} strokeWidth={1.8} />}
          title="No phones waiting"
          text="When a student in your courses gets a new phone, the request appears here. New students' first phones can be activated early here too."
        />
      ) : (
        <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
          <Panel className="px-4 pt-4 pb-2 md:px-6">
            <SectionHead label={`Device changes · ${changes.length}`} />
            <p className="text-[1rem] leading-relaxed text-ink-muted">
              Approving activates the new phone at once and retires the old one.
            </p>
            {changes.length === 0 ? (
              <p className="py-4 text-[1rem] text-ink-muted">None waiting.</p>
            ) : (
              changes.map((request) => (
                <RequestRow
                  key={request.deviceId}
                  request={request}
                  busy={busy === request.deviceId}
                  onApprove={() => void decide(request, true)}
                  onReject={() => setRejecting(request)}
                />
              ))
            )}
          </Panel>

          <Panel className="px-4 pt-4 pb-2 md:px-6">
            <SectionHead label={`New phones cooling off · ${first.length}`} />
            <p className="text-[1rem] leading-relaxed text-ink-muted">
              First phones activate on their own after 12 hours. Approve one early if you know the
              student is holding it.
            </p>
            {first.length === 0 ? (
              <p className="py-4 text-[1rem] text-ink-muted">None cooling off.</p>
            ) : (
              first.map((request) => (
                <RequestRow
                  key={request.deviceId}
                  request={request}
                  busy={busy === request.deviceId}
                  onApprove={() => void decide(request, true)}
                  onReject={() => setRejecting(request)}
                />
              ))
            )}
          </Panel>
        </div>
      )}

      <ConfirmDialog
        open={rejecting !== null}
        destructive
        title={`Reject ${rejecting?.fullName ?? 'this'} phone?`}
        description={
          rejecting?.kind === 'change'
            ? 'Their current phone keeps working. They can request again from the new phone.'
            : 'This phone will not be able to mark attendance. They can register again.'
        }
        confirmLabel="Reject"
        onCancel={() => setRejecting(null)}
        onConfirm={async () => {
          if (rejecting) await decide(rejecting, false)
          setRejecting(null)
        }}
      />
    </>
  )
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

function RequestRow({
  request,
  busy,
  onApprove,
  onReject
}: {
  request: PhoneRequest
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="border-b border-line py-5 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-wash text-[0.95rem] font-semibold text-accent">
          {initials(request.fullName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[1.125rem] font-semibold">{request.fullName}</span>
          <span className="block font-mono text-[0.95rem] text-ink-muted">{request.rollNumber}</span>
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="chip bg-elevated text-ink">
          <Smartphone size={16} strokeWidth={2} /> {describeAgent(request.userAgent)}
        </span>
        <span className="chip bg-elevated text-ink-muted">Registered {formatSessionTime(request.requestedAt)}</span>
        {request.kind === 'first' && request.activeFrom ? (
          <span className="chip bg-warn-wash text-warn">
            <Clock size={16} strokeWidth={2} /> Active from {formatSessionTime(request.activeFrom)}
          </span>
        ) : null}
        {request.replacesSince ? (
          <span className="chip bg-elevated text-ink-muted">Replaces a phone from {formatSessionTime(request.replacesSince)}</span>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          aria-label={`Approve ${request.fullName}'s phone`}
          className="btn-primary"
        >
          {busy ? 'Working…' : request.kind === 'change' ? 'Approve change' : 'Activate now'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          aria-label={`Reject ${request.fullName}'s phone`}
          className="btn-danger"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
