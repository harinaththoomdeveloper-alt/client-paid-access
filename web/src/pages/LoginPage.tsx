import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { config } from '../config'
import { portalService } from '../services'

export function LoginPage() {
  const { client, loading, error: authError } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/'
  if (!loading && client) return <Navigate to={redirectTo} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await portalService.signIn(email, password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="narrow">
      <form className="card form" onSubmit={onSubmit}>
        <h1>Sign in</h1>
        <p className="muted">Sign in to view and purchase your documents.</p>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {(error ?? authError) && <p className="error-text small">{error ?? authError}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {config.useMock && (
          <p className="muted small">
            Mock accounts: <code>client-a@test.com</code> / <code>client-b@test.com</code>, password{' '}
            <code>password123</code>
          </p>
        )}
      </form>
    </main>
  )
}
