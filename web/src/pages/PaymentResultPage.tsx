import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDocuments } from '../hooks/useDocuments'

const MAX_WAIT_MS = 60_000

// Stripe redirects here after checkout. Returning to this page does NOT grant
// access: access is granted only by the verified webhook on the server, so we
// poll Supabase until the entitlement shows up.
export function PaymentSuccessPage() {
  const [params] = useSearchParams()
  const documentId = params.get('document_id')
  const [timedOut, setTimedOut] = useState(false)

  const { docs, error } = useDocuments(2000, (d) => !timedOut && !d.find((x) => x.id === documentId)?.access)
  const doc = docs?.find((d) => d.id === documentId)

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), MAX_WAIT_MS)
    return () => clearTimeout(id)
  }, [])

  let content
  if (error) {
    content = <p className="error-text">{error}</p>
  } else if (doc?.access) {
    content = (
      <>
        <div className="result-icon success">✓</div>
        <h1>Payment confirmed</h1>
        <p className="muted">You now have access to “{doc.title}”.</p>
      </>
    )
  } else if (timedOut) {
    content = (
      <>
        <h1>Still confirming your payment</h1>
        <p className="muted">
          This is taking longer than usual. Your access will appear on the portal as soon as the payment is confirmed.
        </p>
      </>
    )
  } else {
    content = (
      <>
        <div className="spinner" aria-hidden />
        <h1>Confirming your payment…</h1>
        <p className="muted">Waiting for confirmation from Stripe. This usually takes a few seconds.</p>
      </>
    )
  }

  return (
    <main className="narrow">
      <div className="card result">
        {content}
        <Link className="btn btn-primary" to="/">
          Go to portal
        </Link>
      </div>
    </main>
  )
}

export function PaymentCancelPage() {
  return (
    <main className="narrow">
      <div className="card result">
        <h1>Payment cancelled</h1>
        <p className="muted">No payment was taken. You can try again from the portal.</p>
        <Link className="btn btn-primary" to="/">
          Back to portal
        </Link>
      </div>
    </main>
  )
}
