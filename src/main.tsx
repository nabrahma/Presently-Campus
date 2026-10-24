import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { UpdatePrompt } from './components/UpdatePrompt'
import { SessionProvider } from './lib/session'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element is missing from the document.')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <SessionProvider>
          <App />
          <UpdatePrompt />
          <Toaster
            position="top-center"
            offset={16}
            toastOptions={{
              // Toasts read from the app's tokens rather than shipping a
              // second palette that would ignore the theme.
              style: {
                background: 'var(--color-elevated)',
                color: 'var(--color-ink)',
                border: '1px solid var(--color-line)',
                borderRadius: '9999px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem'
              }
            }}
          />
        </SessionProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
