import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, CircleSlash, Maximize, Minimize, Radio, ScanLine } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Logo } from '../../components/Logo'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { QrCode } from '../../components/QrCode'
import { courseLabel } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatTime } from '../../lib/date'
import { flagLabel } from '../../lib/flags'
import { clockOffset, useRotatingToken, useWakeLock } from '../../lib/projector'
import { useSession, useUserId } from '../../lib/session'
import { closeSession, fetchLiveKey, useLiveMarks, useSessionDetail } from '../../lib/teacher'
import { base64Decode, WINDOW_SECONDS } from '../../../supabase/functions/_shared/qrToken.ts'
import { groupReport } from './SessionDetail'

/**
 * The count follows Realtime as marks arrive; this poll is the fallback for a
 * connection that drops events.
 */
const COUNT_REFRESH_MS = 10_000

/**
 * The classroom screen: a rotating QR code as large as the display allows,
 * and how many of the class have scanned it.
 *
 * Tokens are made here from the session's secret, so the code keeps changing
 * every ten seconds even if the connection drops; only the count waits for
 * the network.
 */
export function Projector() {
  const { id } = useParams()
  const navigate = useNavigate()
  const userId = useUserId()
  const { online } = useSession()
  const { data, error, refresh } = useSessionDetail(id)

  const [key, setKey] = useState<{ secret: Uint8Array<ArrayBuffer>; offset: number } | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [fullscreen, setFullscreen] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement))

  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetchLiveKey(id).then(
      (live) => {
        const secret = base64Decode(live.secret)
        if (cancelled) return
        if (!secret) setKeyError('The session key could not be read. Reload to try again.')
        else setKey({ secret, offset: clockOffset(live.serverTime, live.sentAt, live.receivedAt) })
      },
      (failure: unknown) => !cancelled && setKeyError(failure instanceof Error ? failure.message : 'Could not open the session.')
    )
    return () => {
      cancelled = true
    }
  }, [id])

  const open = data?.session.status === 'open'
  const { token, remaining } = useRotatingToken(open ? (key?.secret ?? null) : null, id ?? null, key?.offset ?? 0)
  useWakeLock(open)
  useLiveMarks(id, open)

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => void refresh(), COUNT_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [open, refresh])

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const groups = useMemo(() => groupReport(data?.report ?? []), [data])

  if (!data) {
    if (error || data === null) return <Ended message={error ?? 'This session does not exist.'} />
    return <Booting />
  }
  if (!open) return <Ended message="This session has closed." sessionId={data.session.id} />
  if (keyError) return <Ended message={keyError} sessionId={data.session.id} />

  const { course, session } = data

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg md:flex-row">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4 md:p-8">
        <div className="aspect-square h-full max-h-full w-auto max-w-full md:h-[min(84dvh,60vw)]">
          {token ? (
            <QrCode
              value={token}
              label={`Attendance code for ${course.name}`}
              className="h-full rounded-[2rem] border border-line p-5 shadow-(--shadow-lift)"
            />
          ) : (
            <div className="dot-grid grid h-full place-items-center rounded-[2rem] border border-line bg-surface">
              <p className="title text-[1.375rem] text-ink-muted">Preparing code…</p>
            </div>
          )}
        </div>
        <p className="hidden items-center gap-2.5 text-[1.25rem] font-medium text-ink md:flex">
          <ScanLine size={24} strokeWidth={2} className="text-accent" />
          {online ? 'Open Presently Campus and tap Scan' : 'Scanning needs a connection on the phone'}
        </p>
      </div>

      <aside
        className={cn(
          'flex shrink-0 flex-col gap-6 px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
          'md:my-4 md:mr-4 md:w-[26rem] md:justify-between md:rounded-[2rem] md:border md:border-line md:bg-surface md:p-8 md:shadow-(--shadow-card) lg:w-[30rem]'
        )}
      >
        <div>
          <div className="flex items-center gap-3">
            <Logo className="size-10" />
            <p className="chip bg-accent-wash text-accent">
              <Radio size={16} strokeWidth={2.4} className="motion-safe:animate-pulse" /> Live · started {formatTime(session.startedAt)}
            </p>
          </div>
          <h1 className="title mt-5 text-[1.75rem] md:text-[2.25rem]">{course.name}</h1>
          <p className="mt-1 text-[1.125rem] text-ink-muted">{courseLabel(course)}</p>
        </div>

        <div className="inset p-5">
          <div className="flex items-end justify-between gap-6">
            <div>
              <p className="readout text-[3.5rem] text-ink md:text-[6rem]" aria-live="polite">
                {groups.present.length}
              </p>
              <p className="mt-3 text-[1.125rem] font-medium text-ink-muted">of {groups.expected} marked</p>
            </div>
            <Countdown remaining={remaining} />
          </div>
          <ScanBar marked={groups.present.length} expected={groups.expected} />
        </div>

        {groups.flagged.length > 0 ? (
          <div className="hidden md:block">
            <p className="chip bg-warn-wash text-warn">Recent flags · {groups.flagged.length}</p>
            <ul className="mt-3 space-y-2">
              {[...groups.flagged]
                .sort((a, b) => (b.markedAt ?? '').localeCompare(a.markedAt ?? ''))
                .slice(0, 3)
                .map((row) => (
                  <li key={row.studentId} className="flex gap-3 text-[1rem] text-ink-muted">
                    <span className="w-[6.5rem] shrink-0 font-mono tabular-nums">{row.rollNumber}</span>
                    <span className="truncate">{row.flags.map(flagLabel).join(' · ')}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-3">
          {online ? null : (
            <p className="chip bg-warn-wash text-warn">
              <CircleSlash size={15} strokeWidth={2.2} /> Offline · the code still works, the count will catch up
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <Link to={`/sessions/${session.id}`} aria-label="Session details" className="btn-secondary">
              <ChevronLeft size={19} strokeWidth={2.2} /> Details
            </Link>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
              className="btn-secondary"
            >
              {fullscreen ? <Minimize size={18} strokeWidth={2.2} /> : <Maximize size={18} strokeWidth={2.2} />}
              {fullscreen ? 'Exit full' : 'Full screen'}
            </button>
            <button type="button" className="btn-primary col-span-2" onClick={() => setConfirmClose(true)}>
              Close session
            </button>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={confirmClose}
        title="Close this session?"
        description={`${groups.absent.length} ${groups.absent.length === 1 ? 'student has' : 'students have'} not been marked and will be recorded absent. You can reopen it for 15 minutes.`}
        confirmLabel="Close session"
        onCancel={() => setConfirmClose(false)}
        onConfirm={async () => {
          try {
            await closeSession(userId, session.id)
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
            navigate(`/sessions/${session.id}`, { replace: true })
          } catch (failure) {
            toast.error(failure instanceof Error ? failure.message : 'Could not close the session.')
            setConfirmClose(false)
          }
        }}
      />
    </div>
  )
}

/** Who has scanned, as a row of ticks filled in proportion. */
function ScanBar({ marked, expected }: { marked: number; expected: number }) {
  const segments = 30
  const lit = expected === 0 ? 0 : Math.round((Math.min(marked, expected) / expected) * segments)
  return (
    <div aria-hidden className="mt-5 flex h-8 gap-0.75 md:h-12">
      {Array.from({ length: segments }, (_, index) => (
        <span key={index} className={cn('flex-1 rounded-full', index < lit ? 'bg-accent-bright' : 'bg-line')} />
      ))}
    </div>
  )
}

/** The current window's remaining time, as a ring that empties. */
function Countdown({ remaining }: { remaining: number }) {
  const size = 96
  const stroke = 7
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = Math.max(0, Math.min(1, remaining / WINDOW_SECONDS))

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={`${Math.ceil(remaining)} seconds until the code changes`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-accent-bright"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-[1.5rem] font-medium text-ink tabular-nums">
        {Math.ceil(remaining)}
      </span>
    </div>
  )
}

function Ended({ message, sessionId }: { message: string; sessionId?: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-[26rem] text-center">
        <h1 className="title text-[1.75rem]">{message}</h1>
        <div className="mt-7 space-y-3">
          {sessionId ? (
            <Link to={`/sessions/${sessionId}`} className="btn-primary w-full">
              Session details
            </Link>
          ) : null}
          <Link to="/" className="btn-secondary w-full">
            Courses
          </Link>
        </div>
      </div>
    </div>
  )
}
