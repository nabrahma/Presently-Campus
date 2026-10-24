/**
 * What is recorded and why, shown at sign-up. India's Digital Personal Data
 * Protection Act 2023 applies, and people should know before they scan.
 */
export function PrivacyNotice({ role }: { role: 'student' | 'teacher' }) {
  return (
    <div className="inset px-5 py-5">
      <p className="title text-[1.0625rem]">What is recorded</p>
      {role === 'student' ? (
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[0.975rem] leading-relaxed text-ink-muted">
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
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[0.975rem] leading-relaxed text-ink-muted">
          <li>Your name and email, shown to students in your courses.</li>
          <li>The sessions you run and every mark you make or change, with its reason.</li>
        </ul>
      )}
    </div>
  )
}
