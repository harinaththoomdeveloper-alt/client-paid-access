import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { portalService } from './services'
import type { Client } from './types'

interface AuthState {
  client: Client | null
  loading: boolean
  error: string | null
}

const AuthContext = createContext<AuthState>({ client: null, loading: true, error: null })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ client: null, loading: true, error: null })

  const refresh = useCallback(() => {
    portalService
      .getCurrentClient()
      .then((client) => setState({ client, loading: false, error: null }))
      .catch((e: Error) => setState({ client: null, loading: false, error: e.message }))
  }, [])

  useEffect(() => {
    refresh()
    return portalService.onAuthChange(refresh)
  }, [refresh])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export function RequireAuth({ children }: { children: ReactNode }) {
  const { client, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="center muted">Loading…</div>
  if (!client) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}
