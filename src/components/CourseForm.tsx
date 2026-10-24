import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import type { CourseDraft } from '../lib/teacher'
import {
  MAX_COURSE_CODE_LENGTH,
  MAX_COURSE_NAME_LENGTH,
  MAX_SECTION_LENGTH,
  MAX_TARGET,
  MAX_TERM_LENGTH,
  MIN_TARGET,
  type Course
} from '../types'

/** Create or edit a course. The server checks every limit again. */
export function CourseForm({
  initial,
  submitLabel,
  onSubmit
}: {
  initial?: Course
  submitLabel: string
  onSubmit: (draft: CourseDraft) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [code, setCode] = useState(initial?.code ?? '')
  const [section, setSection] = useState(initial?.section ?? '')
  const [term, setTerm] = useState(initial?.term ?? '')
  const [target, setTarget] = useState(String(initial?.targetPercentage ?? 75))
  const [late, setLate] = useState(String(initial?.lateAfterMinutes ?? 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return

    const parsedTarget = Number(target)
    const parsedLate = Number(late)
    if (!name.trim()) return setError('Give the course a name.')
    if (!Number.isInteger(parsedTarget) || parsedTarget < MIN_TARGET || parsedTarget > MAX_TARGET) {
      return setError(`Target must be a whole number from ${MIN_TARGET} to ${MAX_TARGET}.`)
    }
    if (!Number.isInteger(parsedLate) || parsedLate < 0 || parsedLate > 240) {
      return setError('Late after must be 0 to 240 minutes.')
    }

    setBusy(true)
    setError('')
    try {
      await onSubmit({ name, code, section, term, targetPercentage: parsedTarget, lateAfterMinutes: parsedLate })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the course.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <label className="label mb-2.5 block" htmlFor="course-name">
          Course name
        </label>
        <input
          id="course-name"
          className="field"
          maxLength={MAX_COURSE_NAME_LENGTH}
          placeholder="Database Systems"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label mb-2.5 block" htmlFor="course-code">
            Code
          </label>
          <input
            id="course-code"
            className="field font-mono uppercase"
            maxLength={MAX_COURSE_CODE_LENGTH}
            autoCapitalize="characters"
            placeholder="CS301"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <div>
          <label className="label mb-2.5 block" htmlFor="course-section">
            Section
          </label>
          <input
            id="course-section"
            className="field font-mono uppercase"
            maxLength={MAX_SECTION_LENGTH}
            autoCapitalize="characters"
            placeholder="A"
            value={section}
            onChange={(event) => setSection(event.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label mb-2.5 block" htmlFor="course-term">
          Term
        </label>
        <input
          id="course-term"
          className="field"
          maxLength={MAX_TERM_LENGTH}
          placeholder="Monsoon 2026"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label mb-2.5 block" htmlFor="course-target">
            Target %
          </label>
          <input
            id="course-target"
            className="field"
            type="number"
            inputMode="numeric"
            min={MIN_TARGET}
            max={MAX_TARGET}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        </div>
        <div>
          <label className="label mb-2.5 block" htmlFor="course-late">
            Late after (min)
          </label>
          <input
            id="course-late"
            className="field"
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            value={late}
            onChange={(event) => setLate(event.target.value)}
          />
        </div>
      </div>

      <p className="text-[0.72rem] leading-relaxed text-ink-faint">
        Students below the target are highlighted on the roster. Scans after the late mark are
        flagged for you, not rejected.
      </p>

      {error ? (
        <p role="alert" className="rounded-2xl border border-danger/30 bg-danger-wash px-4 py-3 text-[0.78rem] text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? <Loader2 size={15} className="motion-safe:animate-spin" /> : submitLabel}
      </button>
    </form>
  )
}
