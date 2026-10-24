import { cn } from '../lib/cn'

/**
 * The app's mark: the same drawing as the home-screen icon, so the thing a
 * person taps to open the app is the thing they see inside it. It stays dark
 * in both themes, as an icon does.
 */
export function Logo({ className }: { className?: string }) {
  return (
    // On the dark page a hairline keeps the tile's edge from disappearing.
    <svg viewBox="0 0 512 512" aria-hidden className={cn('shrink-0 rounded-[22.6%] dark:ring-1 dark:ring-white/15', className)}>
      <rect width="512" height="512" rx="116" fill="#16161a" />
      <path
        fill="#f4f4f2"
        transform="translate(-40 -18)"
        d="M154 112h129c84 0 132 47 132 121 0 75-48 123-132 123h-52v73h-77V112Zm77 66v112h43c41 0 62-20 62-56 0-37-21-56-62-56h-43Z"
      />
      <circle cx="380" cy="392" r="34" fill="#f0601f" />
    </svg>
  )
}
