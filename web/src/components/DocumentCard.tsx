import { useState } from 'react'
import { formatDate, formatMoney } from '../format'
import { portalService } from '../services'
import type { CrmSync, PortalDocument } from '../types'
import { StatusBadge } from './StatusBadge'

const crmBadge: Record<CrmSync['status'], { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  synced: { tone: 'success', label: 'Synced' },
  pending: { tone: 'warning', label: 'Pending' },
  failed: { tone: 'danger', label: 'Failed' },
}

export function DocumentCard({ doc }: { doc: PortalDocument }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const buy = () =>
    run(async () => {
      window.location.href = await portalService.startCheckout(doc.id)
    })

  const open = () => {
    // Open the tab synchronously (inside the click) so popup blockers allow it,
    // then point it at the short-lived URL once the server returns it.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    return run(async () => {
      try {
        const url = await portalService.getDocumentUrl(doc.id)
        if (tab) tab.location.href = url
        else window.location.href = url
      } catch (e) {
        tab?.close()
        throw e
      }
    })
  }

  return (
    <article className="card">
      <div className="card-head">
        <div>
          <h2>{doc.title}</h2>
          <p className="muted">{doc.description}</p>
        </div>
        <div className="price">{formatMoney(doc.priceCents, doc.currency)}</div>
      </div>

      <dl className="status-grid">
        <dt>Access</dt>
        <dd>
          {doc.access ? <StatusBadge tone="success">Granted</StatusBadge> : <StatusBadge tone="neutral">Locked</StatusBadge>}
          {doc.access && <span className="muted small">since {formatDate(doc.access.grantedAt)}</span>}
        </dd>

        <dt>Payment</dt>
        <dd>
          {doc.purchase ? (
            <>
              {doc.purchase.refundedAt ? (
                <StatusBadge tone="neutral">Refunded</StatusBadge>
              ) : (
                <StatusBadge tone="success">Paid</StatusBadge>
              )}
              <span className="muted small">
                {formatMoney(doc.purchase.amountCents, doc.purchase.currency)} · ref{' '}
                <code title={doc.purchase.stripeSessionId}>…{doc.purchase.stripeSessionId.slice(-10)}</code>
              </span>
            </>
          ) : (
            <StatusBadge tone="neutral">Not purchased</StatusBadge>
          )}
        </dd>

        <dt>CRM sync</dt>
        <dd>
          {doc.crmSync ? (
            <>
              <StatusBadge tone={crmBadge[doc.crmSync.status].tone}>{crmBadge[doc.crmSync.status].label}</StatusBadge>
              <span className="muted small">
                {doc.crmSync.syncedAt
                  ? `updated ${formatDate(doc.crmSync.syncedAt)}`
                  : `${doc.crmSync.attempts} attempt${doc.crmSync.attempts === 1 ? '' : 's'}`}
              </span>
              {doc.crmSync.lastError && doc.crmSync.status !== 'synced' && (
                <span className="small error-text">{doc.crmSync.lastError}</span>
              )}
            </>
          ) : (
            <span className="muted small">—</span>
          )}
        </dd>
      </dl>

      <div className="card-actions">
        {doc.access ? (
          <button className="btn btn-primary" onClick={open} disabled={busy}>
            {busy ? 'Opening…' : 'Open document'}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={buy} disabled={busy}>
            {busy ? 'Redirecting to checkout…' : `Buy for ${formatMoney(doc.priceCents, doc.currency)}`}
          </button>
        )}
      </div>
      {error && <p className="error-text small">{error}</p>}
    </article>
  )
}
