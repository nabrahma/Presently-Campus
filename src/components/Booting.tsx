import { motion } from 'motion/react'

/**
 * Shown while the session resolves and while a lazily-loaded screen arrives.
 *
 * Deliberately a pulse rather than a spinner: on a fast connection it appears
 * for a few frames, and a spinner that brief reads as a flicker.
 */
export function Booting() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <motion.span
        className="size-3 rounded-full bg-accent-bright"
        animate={{ opacity: [1, 0.2, 1], scale: [1, 0.8, 1] }}
        transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <p className="text-[1.0625rem] text-ink-muted">Loading…</p>
    </div>
  )
}
