import { cn } from '../lib/cn'

/**
 * The app's mark: the same drawing as the home-screen icon, so the thing a
 * person taps to open the app is the thing they see inside it. It keeps its
 * colours in both themes, as an icon does.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={cn('shrink-0 rounded-[22.6%]', className)}>
      <defs>
        <linearGradient id="presently-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#presently-tile)" />
      <path
        fill="#ffffff"
        transform="translate(-40 -18)"
        d="M154 112h129c84 0 132 47 132 121 0 75-48 123-132 123h-52v73h-77V112Zm77 66v112h43c41 0 62-20 62-56 0-37-21-56-62-56h-43Z"
      />
      <circle cx="380" cy="392" r="34" fill="#7dd3fc" />
    </svg>
  )
}
