import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, CircleSlash, Maximize, Minimize, Radio } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { QrCode } from '../../components/QrCode'
import { courseLabel } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatTime } from '../../lib/date'
import { clockOffset, useRotatingToken, useWakeLock } from '../../lib/projector'
import { useSession, useUserId } from '../../lib/session'
import { closeSession, fetchLiveKey, useSessionDetail } from '../../lib/teacher'
import { base64Decode, WINDOW_SECONDS } from '../../../supabase/functions/_shared/qrToken.ts'
import { groupReport } from './SessionDetail'

/** How often the marked count refreshes while the code is up. */
const COUNT_REFRESH_MS = 3_000

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
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-8">
        <div className="aspect-square h-auto w-full max-w-[min(82dvh,100%)] md:h-[min(86dvh,62vw)] md:w-auto">
          {token ? (
            <QrCode value={token} label={`Attendance code for ${course.name}`} className="h-full rounded-[1.75rem] p-4" />
          ) : (
            <div className="grid h-full place-items-center rounded-[1.75rem] border border-line">
              <p className="label">Preparing code</p>
            </div>
          )}
        </div>
      </div>

      <aside className="flex shrink-0 flex-col gap-6 border-line px-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:w-[24rem] md:justify-between md:border-l md:px-8 md:py-8 lg:w-[28rem]">
        <div>
          <p className="label flex items-center gap-2 text-accent">
            <Radio size={12} strokeWidth={2.4} className="motion-safe:animate-pulse" /> Live · started {formatTime(session.startedAt)}
          </p>
          <p className="mt-4 font-mono text-[0.85rem] tracking-[0.06em] text-ink-muted uppercase">{courseLabel(course)}</p>
          <h1 className="mt-2 text-[1.6rem] leading-tight tracking-[-0.01em] md:text-[2rem]">{course.name}</h1>
        </div>

        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="readout text-[4.5rem] leading-none text-accent md:text-[6rem]" aria-live="polite">
              {groups.present.length}
            </p>
            <p className="mt-3 font-mono text-[0.85rem] tracking-[0.04em] text-ink-muted">
              of {groups.expected} marked
            </p>
          </div>
          <Countdown remaining={remaining} />
        </div>

        <div className="space-y-3">
          <p className={cn('label flex items-center gap-1.5', online ? 'text-ink-faint' : 'text-warn')}>
            {online ? (
              'Scan with Presently Campus · Scan tab'
            ) : (
              <>
                <CircleSlash size={11} strokeWidth={2.2} /> Offline · the code still works, the count will catch up
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Link
              to={`/sessions/${session.id}`}
              aria-label="Session details"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line text-ink-muted active:opacity-60"
            >
              <ChevronLeft size={17} strokeWidth={2} />
            </Link>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line text-ink-muted active:opacity-60"
            >
              {fullscreen ? <Minimize size={16} strokeWidth={2} /> : <Maximize size={16} strokeWidth={2} />}
            </button>
            <button type="button" className="btn-secondary h-12 flex-1" onClick={() => setConfirmClose(true)}>
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

/** The current window's remaining time, as a ring that empties. */
function Countdown({ remaining }: { remaining: number }) {
  const size = 84
  const stroke = 4
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
          className="stroke-accent"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-[1.1rem] text-ink tabular-nums">
        {Math.ceil(remaining)}
      </span>
    </div>
  )
}

function Ended({ message, sessionId }: { message: string; sessionId?: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-[22rem] text-center">
        <h1 className="readout text-[1.3rem]">{message}</h1>
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
