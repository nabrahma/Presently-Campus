import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, Loader2, QrCode } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { LoadError } from '../../components/LoadError'
import { Panel, Readout, SectionHead } from '../../components/Panel'
import { Sheet } from '../../components/Sheet'
import { courseLabel } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatSessionTime, formatTime } from '../../lib/date'
import { FLAG_HELP, flagLabel, REVIEW_REASONS } from '../../lib/flags'
import { useUserId } from '../../lib/session'
import {
  cancelSession,
  closeSession,
  reopenSession,
  teacherMark,
  useLiveMarks,
  useSessionDetail,
  type ReportStatus,
  type SessionReportRow
} from '../../lib/teacher'
import { MAX_REASON_LENGTH } from '../../types'

/** A closed session can be reopened for this long, matching the server. */
const REOPEN_WINDOW_MS = 15 * 60_000
/** A fallback poll for an open session; Realtime does the work while it is connected. */
const LIVE_REFRESH_MS = 15_000

export function TeacherSessionDetail() {
  const { id } = useParams()
  const userId = useUserId()
  const { data, error, refresh } = useSessionDetail(id)
  const [marking, setMarking] = useState<SessionReportRow | null>(null)
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const status = data?.session.status
  useLiveMarks(id, status === 'open')
  useEffect(() => {
    if (status !== 'open') return
    const timer = window.setInterval(() => void refresh(), LIVE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh, status])

  // Keeps the reopen button honest about its window without a server trip.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const groups = useMemo(() => groupReport(data?.report ?? []), [data])

  if (data === null) return <Navigate to="/" replace />
  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />

  const { session, course } = data
  const open = session.status === 'open'
  const canReopen =
    session.status === 'closed' && session.closedAt !== null && now - Date.parse(session.closedAt) < REOPEN_WINDOW_MS

  const act = async (action: 'close' | 'cancel' | 'reopen') => {
    try {
      if (action === 'close') await closeSession(userId, session.id)
      else if (action === 'cancel') await cancelSession(userId, session.id)
      else await reopenSession(userId, session.id)
      toast.success(action === 'close' ? 'Session closed' : action === 'cancel' ? 'Session cancelled' : 'Session reopened')
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'That did not work.')
    }
  }

  return (
    <>
      <Link
        to={`/courses/${course.id}`}
        className="mb-5 inline-flex items-center gap-1.5 font-mono text-[0.65rem] tracking-[0.1em] text-ink-muted uppercase active:opacity-60"
      >
        <ChevronLeft size={14} strokeWidth={2.2} />
        {courseLabel(course)}
      </Link>

      <header className="mb-6">
        <p className={cn('label', open && 'text-accent')}>
          {open ? 'Live' : session.status === 'cancelled' ? 'Cancelled · counts for no one' : 'Closed'}
          {session.closedAt && !open ? ` at ${formatTime(session.closedAt)}` : ''}
        </p>
        <h1 className="mt-2.5 text-[1.4rem] leading-tight tracking-[-0.01em]">{course.name}</h1>
        <p className="mt-2 font-mono text-[0.62rem] tracking-[0.08em] text-ink-faint uppercase">
          {formatSessionTime(session.startedAt)}
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-3">
        {open ? (
          <>
            <Link to={`/live/${session.id}`} className="btn-primary flex-1 md:flex-none">
              <QrCode size={15} strokeWidth={2.2} /> Show code
            </Link>
            <button type="button" className="btn-secondary flex-1 md:flex-none" onClick={() => setConfirm('close')}>
              Close session
            </button>
          </>
        ) : null}
        {canReopen ? (
          <button type="button" className="btn-secondary flex-1 md:flex-none" onClick={() => void act('reopen')}>
            Reopen
          </button>
        ) : null}
        {session.status !== 'cancelled' ? (
          <button type="button" className="btn-danger flex-1 md:flex-none" onClick={() => setConfirm('cancel')}>
            Cancel session
          </button>
        ) : null}
      </div>

      <div className="mb-7 grid grid-cols-3 gap-3">
        <Panel className="px-4 py-3.5">
          <Readout label="Present" value={String(groups.present.length)} suffix={`/${groups.expected}`} size="sm" tone="accent" />
        </Panel>
        <Panel className="px-4 py-3.5">
          <Readout label={open ? 'Not yet' : 'Absent'} value={String(groups.absent.length)} size="sm" tone={groups.absent.length > 0 && !open ? 'danger' : 'default'} />
        </Panel>
        <Panel className="px-4 py-3.5">
          <Readout label="Excused" value={String(groups.excused.length)} size="sm" />
        </Panel>
      </div>

      {groups.flagged.length > 0 && session.status !== 'cancelled' ? (
        <div className="mb-7">
          <SectionHead label={`Flagged · ${groups.flagged.length}`} />
          <p className="pt-2 text-[0.72rem] leading-relaxed text-ink-faint">
            Flags never block a scan. Keep the mark if it looks genuine, or remove it if it was a proxy.
          </p>
          {groups.flagged.map((row) => (
            <FlaggedRow
              key={row.studentId}
              row={row}
              onReview={async (verdict) => {
                try {
                  await teacherMark(
                    userId,
                    session.id,
                    row.studentId,
                    verdict === 'genuine' ? 'present' : 'absent',
                    REVIEW_REASONS[verdict]
                  )
                  toast.success(verdict === 'genuine' ? `${row.fullName}: kept` : `${row.fullName}: marked absent`)
                } catch (failure) {
                  toast.error(failure instanceof Error ? failure.message : 'That did not work.')
                }
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="space-y-7 lg:grid lg:grid-cols-2 lg:gap-8 lg:space-y-0">
        <ReportList
          label={open ? 'Not marked yet' : 'Absent'}
          rows={groups.absent}
          empty={open ? 'Everyone expected is marked.' : 'Nobody was absent.'}
          editable={session.status !== 'cancelled'}
          onPick={setMarking}
        />
        <div className="space-y-7">
          <ReportList
            label="Present"
            rows={groups.present}
            empty="Nobody marked yet."
            editable={session.status !== 'cancelled'}
            onPick={setMarking}
          />
          {groups.excused.length > 0 ? (
            <ReportList label="Excused" rows={groups.excused} editable={session.status !== 'cancelled'} onPick={setMarking} />
          ) : null}
          {groups.notExpected.length > 0 ? (
            <ReportList
              label="Joined after this class"
              rows={groups.notExpected}
              note="Not counted unless you mark them."
              editable={session.status !== 'cancelled'}
              onPick={setMarking}
            />
          ) : null}
        </div>
      </div>

      <MarkSheet
        row={marking}
        onClose={() => setMarking(null)}
        onSave={async (status, reason) => {
          if (!marking) return
          await teacherMark(userId, session.id, marking.studentId, status, reason)
          setMarking(null)
          toast.success(`${marking.fullName}: ${status}`)
        }}
      />

      <ConfirmDialog
        open={confirm === 'close'}
        title="Close this session?"
        description={`Everyone enrolled who was not marked is recorded absent: ${groups.absent.length} ${groups.absent.length === 1 ? 'student' : 'students'}. You can reopen it for 15 minutes.`}
        confirmLabel="Close session"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await act('close')
          setConfirm(null)
        }}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        destructive
        title="Cancel this session?"
        description="A cancelled session counts for no one, present or absent. Marks already made are kept but ignored."
        confirmLabel="Cancel session"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await act('cancel')
          setConfirm(null)
        }}
      />
    </>
  )
}

export function groupReport(report: SessionReportRow[]) {
  const present = report.filter((row) => row.status === 'present')
  const excused = report.filter((row) => row.status === 'excused')
  const absent = report.filter((row) => row.status === 'absent' && !row.joinedAfterStart)
  const notExpected = report.filter((row) => row.status === 'absent' && row.joinedAfterStart)
  const flagged = present.filter((row) => row.flags.length > 0)
  // Who this session counts for: everyone enrolled before it, plus anyone marked anyway.
  const expected = report.length - notExpected.length - excused.length
  return { present, excused, absent, notExpected, expected, flagged }
}

function ReportList({
  label,
  rows,
  empty,
  note,
  editable,
  onPick
}: {
  label: string
  rows: SessionReportRow[]
  empty?: string
  note?: string
  editable: boolean
  onPick: (row: SessionReportRow) => void
}) {
  return (
    <div>
      <SectionHead label={`${label} · ${rows.length}`} />
      {note ? <p className="pt-2 text-[0.72rem] text-ink-faint">{note}</p> : null}
      {rows.length === 0 ? (
        <p className="py-4 text-[0.8rem] text-ink-muted">{empty}</p>
      ) : (
        rows.map((row) => (
          <button
            key={row.studentId}
            type="button"
            disabled={!editable}
            onClick={() => onPick(row)}
            className="hover-row flex w-full items-center gap-3 border-b border-line py-3 text-left last:border-b-0 active:opacity-60 disabled:active:opacity-100 md:px-2"
          >
            <span className="w-[5.5rem] shrink-0 font-mono text-[0.72rem] text-ink-muted tabular-nums">{row.rollNumber}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.85rem]">{row.fullName}</span>
              {row.markedAt ? (
                <span className="mt-1 block truncate font-mono text-[0.6rem] tracking-[0.06em] text-ink-faint">
                  {row.method === 'qr' ? `Scanned ${formatTime(row.markedAt)}` : `By hand · ${row.reason ?? ''}`}
                </span>
              ) : null}
            </span>
            {row.flags.length > 0 ? <span className="label text-warn">{row.flags.map(flagLabel).join(' · ')}</span> : null}
          </button>
        ))
      )}
    </div>
  )
}

function FlaggedRow({
  row,
  onReview
}: {
  row: SessionReportRow
  onReview: (verdict: 'genuine' | 'proxy') => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const review = async (verdict: 'genuine' | 'proxy') => {
    setBusy(true)
    try {
      await onReview(verdict)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-line py-4 last:border-b-0">
      <div className="flex items-baseline gap-3">
        <span className="w-[5.5rem] shrink-0 font-mono text-[0.72rem] text-ink-muted tabular-nums">{row.rollNumber}</span>
        <span className="min-w-0 flex-1 truncate text-[0.88rem]">{row.fullName}</span>
        {row.markedAt ? <span className="font-mono text-[0.65rem] text-ink-faint">{formatTime(row.markedAt)}</span> : null}
      </div>
      <ul className="mt-2 space-y-1">
        {row.flags.map((flag) => (
          <li key={flag} className="text-[0.72rem] leading-relaxed text-ink-muted">
            <span className="text-warn">{flagLabel(flag)}.</span> {FLAG_HELP[flag] ?? ''}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void review('genuine')}
          className="h-10 flex-1 rounded-full border border-line-strong font-mono text-[0.65rem] tracking-[0.1em] uppercase active:opacity-60 disabled:opacity-40"
        >
          Looks genuine
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void review('proxy')}
          className="h-10 flex-1 rounded-full border border-danger/40 font-mono text-[0.65rem] tracking-[0.1em] text-danger uppercase active:opacity-60 disabled:opacity-40"
        >
          Proxy · mark absent
        </button>
      </div>
    </div>
  )
}

const CHOICES: Array<[ReportStatus, string]> = [
  ['present', 'Present'],
  ['excused', 'Excused'],
  ['absent', 'Absent']
]

function MarkSheet({
  row,
  onClose,
  onSave
}: {
  row: SessionReportRow | null
  onClose: () => void
  onSave: (status: ReportStatus, reason: string) => Promise<void>
}) {
  const [status, setStatus] = useState<ReportStatus>('present')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Each student opens with the opposite of what they have, which is almost
  // always the correction being made.
  useEffect(() => {
    if (!row) return
    setStatus(row.status === 'present' ? 'absent' : 'present')
    setReason('')
    setError('')
  }, [row])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!reason.trim()) {
      setError('Give a reason. It is kept with the mark.')
      return
    }
    setBusy(true)
    try {
      await onSave(status, reason.trim())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the mark.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={row !== null}
      onClose={onClose}
      title={row?.fullName ?? 'Mark'}
      description={row ? `${row.rollNumber} · currently ${row.status}` : undefined}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <div role="radiogroup" aria-label="Mark as" className="grid grid-cols-3 gap-2">
          {CHOICES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={status === value}
              onClick={() => setStatus(value)}
              className={cn(
                'h-12 rounded-full border font-mono text-[0.7rem] tracking-[0.08em] uppercase transition-colors',
                status === value ? 'border-accent bg-accent text-bg' : 'border-line text-ink-muted'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <label className="label mb-2.5 block" htmlFor="mark-reason">
            Reason
          </label>
          <input
            id="mark-reason"
            className="field"
            maxLength={MAX_REASON_LENGTH}
            placeholder={status === 'excused' ? 'Medical leave' : 'Phone battery dead'}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
              if (error) setError('')
            }}
          />
        </div>

        {error ? (
          <p role="alert" className="text-[0.75rem] text-danger">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="motion-safe:animate-spin" /> : 'Save mark'}
        </button>
      </form>
    </Sheet>
  )
}
