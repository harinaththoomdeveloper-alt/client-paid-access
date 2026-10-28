export type CrmSyncStatus = 'pending' | 'synced' | 'failed'

export interface Client {
  id: string
  email: string
  fullName: string
}

export interface Purchase {
  id: string
  stripeSessionId: string
  amountCents: number
  currency: string
  paidAt: string
  refundedAt: string | null
}

export interface CrmSync {
  status: CrmSyncStatus
  attempts: number
  lastError: string | null
  syncedAt: string | null
}

export interface PortalDocument {
  id: string
  title: string
  description: string
  priceCents: number
  currency: string
  // null until the payment webhook has granted access
  access: { grantedAt: string } | null
  purchase: Purchase | null
  crmSync: CrmSync | null
}

// Everything the UI needs. Implemented by the real Supabase/API service
// and by an in-browser mock so the UI can be built before the backend exists.
export interface PortalService {
  getCurrentClient(): Promise<Client | null>
  onAuthChange(callback: () => void): () => void
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  getDocuments(): Promise<PortalDocument[]>
  // Returns the Stripe Checkout URL to redirect to
  startCheckout(documentId: string): Promise<string>
  // Returns a short-lived URL to view the document
  getDocumentUrl(documentId: string): Promise<string>
}
