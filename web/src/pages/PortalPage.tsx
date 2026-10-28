import { useAuth } from '../auth'
import { DocumentCard } from '../components/DocumentCard'
import { useDocuments } from '../hooks/useDocuments'

export function PortalPage() {
  const { client } = useAuth()
  // Keep refreshing while a CRM update is still pending so the status flips live
  const { docs, error, reload } = useDocuments(5000, (d) => d.some((x) => x.crmSync?.status === 'pending'))

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Welcome, {client?.fullName}</h1>
          <p className="muted">Your documents, access and CRM sync status.</p>
        </div>
        <button className="btn btn-ghost" onClick={reload}>
          Refresh
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!docs && !error && <p className="muted">Loading documents…</p>}
      {docs?.length === 0 && <p className="muted">No documents available.</p>}
      <div className="grid">{docs?.map((doc) => <DocumentCard key={doc.id} doc={doc} />)}</div>
    </main>
  )
}
