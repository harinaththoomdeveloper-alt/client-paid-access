import { useAuth } from '../auth'
import { config } from '../config'
import { portalService } from '../services'

export function Header() {
  const { client } = useAuth()
  return (
    <header className="header">
      <div className="brand">
        Client Portal
        {config.useMock && <span className="mock-tag">mock data</span>}
      </div>
      {client && (
        <div className="header-user">
          <span className="muted">{client.email}</span>
          <button className="btn btn-ghost" onClick={() => portalService.signOut()}>
            Sign out
          </button>
        </div>
      )}
    </header>
  )
}
