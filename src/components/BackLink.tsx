import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

/** The way back from a detail screen: a real button with the place it returns to. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="mb-5 inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface pr-4 pl-2.5 text-[1rem] font-medium text-ink transition-colors hover:bg-elevated"
    >
      <ChevronLeft size={20} strokeWidth={2.2} />
      {label}
    </Link>
  )
}
