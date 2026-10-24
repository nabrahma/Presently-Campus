/**
 * What is recorded and why, shown at sign-up. India's Digital Personal Data
 * Protection Act 2023 applies, and people should know before they scan.
 */
export function PrivacyNotice({ role }: { role: 'student' | 'teacher' }) {
  return (
    <div className="rounded-2xl border border-line px-4 py-4">
      <p className="label">What is recorded</p>
      {role === 'student' ? (
        <ul className="mt-3 space-y-2 text-[0.78rem] leading-relaxed text-ink-muted">
          <li>Your name, roll number and email, so your teachers can see your attendance.</li>
          <li>
            A key that identifies this phone, so only you can mark from it. The phone keeps the
            private half; we never see it.
          </li>
          <li>
            For each scan: when it happened, the network address and the browser it came from, to
            spot proxy attendance. Network and browser details are deleted after 90 days.
          </li>
          <li>No photos, no location and no biometric data.</li>
        </ul>
      ) : (
        <ul className="mt-3 space-y-2 text-[0.78rem] leading-relaxed text-ink-muted">
          <li>Your name and email, shown to students in your courses.</li>
          <li>The sessions you run and every mark you make or change, with its reason.</li>
        </ul>
      )}
    </div>
  )
}
