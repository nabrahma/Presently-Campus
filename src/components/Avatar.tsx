import { cn } from '../lib/cn'

/* Written out in full so Tailwind sees every class. */
const TINTS = [
  'bg-avatar-1 text-avatar-1-ink',
  'bg-avatar-2 text-avatar-2-ink',
  'bg-avatar-3 text-avatar-3-ink',
  'bg-avatar-4 text-avatar-4-ink',
  'bg-avatar-5 text-avatar-5-ink',
  'bg-avatar-6 text-avatar-6-ink'
]

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

/** The same name always gets the same tint, so a face is recognised by colour too. */
function tintOf(name: string): string {
  // FNV-1a: short names that differ by a letter still land on different tints.
  let hash = 0x811c9dc5
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return TINTS[hash % TINTS.length]
}

/**
 * A person's initials on a soft tint, standing in for the photo a staff
 * directory would show. Decorative: the name always appears beside it.
 */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-full text-[0.95rem] font-bold tracking-tight',
        tintOf(name),
        className
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
