import { useState } from 'react'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { SectionHead } from '../../components/Panel'
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
      <ScreenHead label={data.length === 0 ? 'Nothing waiting' : `${data.length} waiting`} title="Approvals" />

      {data.length === 0 ? (
        <Empty
          icon={<ShieldCheck size={18} strokeWidth={1.8} />}
          title="No phones waiting"
          text="When a student in your courses gets a new phone, the request appears here. New students' first phones can be activated early here too."
        />
      ) : (
        <div className="space-y-7 lg:grid lg:grid-cols-2 lg:gap-8 lg:space-y-0">
          <div>
            <SectionHead label={`Device changes · ${changes.length}`} />
            <p className="pt-2 text-[0.72rem] leading-relaxed text-ink-faint">
              Approving activates the new phone at once and retires the old one.
            </p>
            {changes.length === 0 ? (
              <p className="py-4 text-[0.8rem] text-ink-muted">None waiting.</p>
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
          </div>

          <div>
            <SectionHead label={`New phones cooling off · ${first.length}`} />
            <p className="pt-2 text-[0.72rem] leading-relaxed text-ink-faint">
              First phones activate on their own after 12 hours. Approve one early if you know the
              student is holding it.
            </p>
            {first.length === 0 ? (
              <p className="py-4 text-[0.8rem] text-ink-muted">None cooling off.</p>
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
          </div>
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
    <div className="border-b border-line py-4 last:border-b-0">
      <div className="flex items-baseline gap-3">
        <span className="w-[5.5rem] shrink-0 font-mono text-[0.72rem] text-ink-muted tabular-nums">{request.rollNumber}</span>
        <span className="min-w-0 flex-1 truncate text-[0.88rem]">{request.fullName}</span>
      </div>
      <p className="mt-2 font-mono text-[0.62rem] leading-relaxed tracking-[0.04em] text-ink-faint">
        {describeAgent(request.userAgent)} · registered {formatSessionTime(request.requestedAt)}
        {request.kind === 'first' && request.activeFrom ? ` · active from ${formatSessionTime(request.activeFrom)}` : ''}
        {request.replacesSince ? ` · replaces a phone from ${formatSessionTime(request.replacesSince)}` : ''}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          aria-label={`Approve ${request.fullName}'s phone`}
          className="h-10 flex-1 rounded-full bg-accent font-mono text-[0.65rem] tracking-[0.1em] text-bg uppercase active:opacity-80 disabled:opacity-40"
        >
          {busy ? 'Working' : request.kind === 'change' ? 'Approve change' : 'Activate now'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          aria-label={`Reject ${request.fullName}'s phone`}
          className="h-10 rounded-full border border-danger/40 px-5 font-mono text-[0.65rem] tracking-[0.1em] text-danger uppercase active:opacity-60 disabled:opacity-40"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
