import { CloudOff } from 'lucide-react'
import { Empty } from './Empty'

/** A screen whose data could not be fetched and has nothing cached to show. */
export function LoadError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <Empty
      icon={<CloudOff size={26} strokeWidth={1.8} />}
      title="Could not load this"
      text={error ?? 'Check your connection and try again.'}
      action={
        <button type="button" className="btn-secondary" onClick={onRetry}>
          Try again
        </button>
      }
    />
  )
}
