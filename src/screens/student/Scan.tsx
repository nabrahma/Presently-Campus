import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { CameraOff, Check, ChevronRight, CircleSlash, Loader2, ScanLine, TriangleAlert, X } from 'lucide-react'
import type QrScannerType from 'qr-scanner'
import { describePhone } from '../../components/PhonePanel'
import { ScreenHead } from '../../components/Shell'
import { cn } from '../../lib/cn'
import { formatTime } from '../../lib/date'
import { submitScan, usePhoneStatus, type ScanResult } from '../../lib/devices'
import { useSession, useUserId } from '../../lib/session'

type Camera = 'starting' | 'live' | 'denied' | 'missing' | 'failed'

type Verdict =
  | { kind: 'checking' }
  | { kind: 'done'; result: ScanResult | { ok: false; reason: string; message: string } }

const JOIN_LINK = /\/join\/([A-Za-z0-9]{6})(?:[/?#]|$)/
/** A code that is not ours is mentioned once, not on every frame it stays in view. */
const IGNORE_REPEAT_MS = 3_000

/**
 * The camera, a framing guide, and the verdict.
 *
 * Decoding runs in qr-scanner's worker, which works on iOS Safari where the
 * BarcodeDetector API does not exist. The library loads with this screen only.
 */
export function Scan() {
  const navigate = useNavigate()
  const userId = useUserId()
  const { online } = useSession()
  const { status: phone } = usePhoneStatus()

  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScannerType | null>(null)
  const busyRef = useRef(false)
  const lastIgnored = useRef<{ text: string; at: number } | null>(null)

  const [camera, setCamera] = useState<Camera>('starting')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [hint, setHint] = useState('')

  const handle = useCallback(
    (text: string) => {
      if (busyRef.current) return

      if (text.startsWith('p1.')) {
        busyRef.current = true
        void scannerRef.current?.pause()
        setHint('')
        setVerdict({ kind: 'checking' })
        submitScan(userId, text)
          .then((result) => {
            setVerdict({ kind: 'done', result })
            navigator.vibrate?.(result.ok ? 40 : [30, 60, 30])
          })
          .catch(() =>
            setVerdict({
              kind: 'done',
              result: { ok: false, reason: 'network', message: 'Cannot reach the server. Check your connection and scan again.' }
            })
          )
        return
      }

      const join = JOIN_LINK.exec(text)
      if (join) {
        busyRef.current = true
        navigate(`/join/${join[1].toUpperCase()}`)
        return
      }

      const now = Date.now()
      if (lastIgnored.current?.text === text && now - lastIgnored.current.at < IGNORE_REPEAT_MS) return
      lastIgnored.current = { text, at: now }
      setHint("That isn't a Presently code.")
    },
    [navigate, userId]
  )

  // The scanner keeps the handler it was made with, so it calls through a ref.
  const handleRef = useRef(handle)
  handleRef.current = handle

  useEffect(() => {
    const video = videoRef.current
    if (!online || !video) return

    let cancelled = false
    setCamera('starting')

    void import('qr-scanner').then(({ default: QrScanner }) => {
      if (cancelled) return
      const scanner = new QrScanner(video, (result) => handleRef.current(result.data), {
        returnDetailedScanResult: true,
        preferredCamera: 'environment',
        maxScansPerSecond: 8,
        highlightScanRegion: false,
        highlightCodeOutline: false,
        onDecodeError: () => undefined
      })
      scannerRef.current = scanner
      scanner.start().then(
        () => !cancelled && setCamera('live'),
        (failure: unknown) => {
          if (cancelled) return
          const text = String((failure as { name?: string })?.name ?? failure)
          setCamera(/NotAllowed|Permission|denied|Security/i.test(text) ? 'denied' : /not found|NotFound|Overconstrained/i.test(text) ? 'missing' : 'failed')
        }
      )
    })

    return () => {
      cancelled = true
      scannerRef.current?.destroy()
      scannerRef.current = null
    }
  }, [online])

  const again = () => {
    busyRef.current = false
    setVerdict(null)
    void scannerRef.current?.start().catch(() => setCamera('failed'))
  }

  const warning = phone && phone.kind !== 'active' ? describePhone(phone) : null

  return (
    <>
      <ScreenHead label="Point at the teacher's screen" title="Scan" icon={<ScanLine size={26} strokeWidth={2} />} />

      {warning ? (
        <Link
          to="/settings"
          className="mb-5 flex items-center gap-3.5 rounded-panel border border-warn/40 bg-warn-wash px-4 py-4 active:opacity-70 md:px-5"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-warn">
            <TriangleAlert size={22} strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1 text-[1rem] leading-relaxed">
            <span className="font-semibold text-warn">{warning.label}.</span> <span className="text-ink">{warning.text}</span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-ink-muted" />
        </Link>
      ) : null}

      {/* A viewfinder is dark in both themes, as a camera's is. */}
      <div className="relative mx-auto aspect-[3/4] max-h-[64dvh] w-full max-w-[52rem] overflow-hidden rounded-[1.75rem] border border-line bg-[#111113] shadow-(--shadow-card) md:aspect-video">
        {online ? (
          // Muted and inline, or iOS refuses to play it without a tap.
          <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
        ) : null}

        {online && camera === 'live' && !verdict ? <FramingGuide /> : null}

        {!online ? (
          <Notice icon={<CircleSlash size={20} />} title="You are offline">
            Scanning needs a connection, because a code is only valid for a few seconds. Your
            attendance is still readable on Home.
          </Notice>
        ) : camera === 'starting' ? (
          <Notice icon={<Loader2 size={20} className="motion-safe:animate-spin" />} title="Opening the camera" />
        ) : camera === 'denied' ? (
          <Notice icon={<CameraOff size={20} />} title="Camera access is off">
            Allow the camera for this site, then reopen Scan. On iPhone: Settings → Safari → Camera →
            Allow. On Android: tap the lock beside the address, then Permissions → Camera.
          </Notice>
        ) : camera === 'missing' ? (
          <Notice icon={<CameraOff size={20} />} title="No camera found">
            Scan with a phone that has a rear camera. If you have none, your teacher can mark you by hand.
          </Notice>
        ) : camera === 'failed' ? (
          <Notice icon={<CameraOff size={20} />} title="The camera did not start">
            Close other apps using the camera and try again.
          </Notice>
        ) : null}

        {verdict ? <VerdictCard verdict={verdict} onAgain={again} /> : null}
      </div>

      <p role="status" className="mt-4 min-h-7 text-center text-[1.0625rem] font-medium text-ink-muted">
        {hint || (camera === 'live' && !verdict ? 'Hold steady. It reads the code on its own.' : '')}
      </p>
    </>
  )
}

/** Four corner marks: where to put the code, without hiding the picture. */
function FramingGuide() {
  const corner = 'absolute h-12 w-12 border-accent-bright'
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="relative aspect-square w-[62%] max-w-[18rem]">
        <span className={cn(corner, 'top-0 left-0 rounded-tl-3xl border-t-[5px] border-l-[5px]')} />
        <span className={cn(corner, 'top-0 right-0 rounded-tr-3xl border-t-[5px] border-r-[5px]')} />
        <span className={cn(corner, 'bottom-0 left-0 rounded-bl-3xl border-b-[5px] border-l-[5px]')} />
        <span className={cn(corner, 'right-0 bottom-0 rounded-br-3xl border-r-[5px] border-b-[5px]')} />
      </div>
    </div>
  )
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="dot-grid absolute inset-0 flex flex-col items-center justify-center bg-elevated px-8 text-center">
      <span className="grid size-16 place-items-center rounded-2xl border border-line bg-surface text-ink shadow-(--shadow-card) [&_svg]:size-7">
        {icon}
      </span>
      <p className="title mt-5 text-[1.375rem]">{title}</p>
      {children ? <p className="mt-3 max-w-[26rem] text-[1rem] leading-relaxed text-ink-muted">{children}</p> : null}
    </div>
  )
}

const DEVICE_REASONS = new Set(['device_not_registered', 'device_too_new', 'device_unverified', 'device_already_used'])

function VerdictCard({ verdict, onAgain }: { verdict: Verdict; onAgain: () => void }) {
  if (verdict.kind === 'checking') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/90 backdrop-blur-sm">
        <Loader2 size={40} className="text-accent motion-safe:animate-spin" />
        <p className="title mt-5 text-[1.375rem]">Checking…</p>
      </div>
    )
  }

  const { result } = verdict
  const marked = 'courseName' in result && result.courseName
  const success = result.ok

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center px-8 text-center',
        success ? 'bg-good-wash' : 'bg-danger-wash'
      )}
    >
      <motion.span
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        className={cn(
          'grid size-24 place-items-center rounded-full text-surface',
          success ? 'bg-good-bright' : 'bg-danger'
        )}
      >
        {success ? <Check size={48} strokeWidth={2.8} /> : <X size={48} strokeWidth={2.8} />}
      </motion.span>

      <p className={cn('title mt-6 max-w-[26rem] text-[1.75rem]', success ? 'text-good' : 'text-danger')}>{result.message}</p>

      {marked ? (
        <p className="mt-3 text-[1.125rem] font-medium text-ink">
          {result.courseName}
          {'markedAt' in result && result.markedAt ? ` · ${formatTime(result.markedAt)}` : ''}
        </p>
      ) : null}

      <div className="mt-8 flex w-full max-w-[22rem] flex-col gap-3">
        {success ? (
          <Link to="/" className="btn-primary w-full">
            Done
          </Link>
        ) : (
          <button type="button" className="btn-primary w-full" onClick={onAgain}>
            Scan again
          </button>
        )}
        {!success && DEVICE_REASONS.has(result.reason) ? (
          <Link to="/settings" className="btn-secondary w-full">
            Check this phone
          </Link>
        ) : null}
      </div>
    </motion.div>
  )
}
