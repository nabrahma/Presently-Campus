import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Without this, one bad render anywhere leaves a blank screen and no way
 * forward. Attendance lives on the server, so reloading is a genuine recovery
 * rather than a placebo.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Presently Campus crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="w-full max-w-[22rem] text-center">
          <h1 className="readout text-[1.3rem]">Something broke</h1>
          <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-muted">
            Attendance is kept on the server, so nothing is lost. Reloading usually clears this.
          </p>
          <button
            type="button"
            className="btn-primary mt-7 w-full"
            onClick={() => window.location.assign('/')}
          >
            Reload
          </button>
          {import.meta.env.DEV ? (
            <pre className="mt-6 overflow-x-auto rounded-2xl border border-line p-3 text-left font-mono text-[0.68rem] text-ink-muted">
              {error.message}
            </pre>
          ) : null}
        </div>
      </div>
    )
  }
}
