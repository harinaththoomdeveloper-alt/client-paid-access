import { config } from '../config'
import type { Client, PortalDocument, PortalService } from '../types'

// In-browser stand-in for Supabase + backend, used only while the backend
// is not built yet (VITE_USE_MOCK=true). State is kept in localStorage.

const STORAGE_KEY = 'mock-portal-state'
const WEBHOOK_DELAY_MS = 3000

const MOCK_USERS: (Client & { password: string })[] = [
  { id: 'client-a', email: 'client-a@test.com', fullName: 'Client A', password: 'password123' },
  { id: 'client-b', email: 'client-b@test.com', fullName: 'Client B', password: 'password123' },
]

const MOCK_DOCUMENTS = [
  {
    id: 'doc-sample',
    title: 'Sample Document',
    description: 'Paid sample document unlocked after a successful Stripe test payment.',
    priceCents: 4900,
    currency: 'usd',
  },
]

interface MockState {
  currentUserId: string | null
  // keyed by `${clientId}:${documentId}`
  purchases: Record<string, { sessionId: string; completesAt: number }>
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore corrupt or unavailable storage
  }
  return { currentUserId: null, purchases: {} }
}

function save(state: MockState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createMockService(): PortalService {
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  function requireUser(): string {
    const { currentUserId } = load()
    if (!currentUserId) throw new Error('Not signed in')
    return currentUserId
  }

  return {
    async getCurrentClient() {
      await delay(150)
      const user = MOCK_USERS.find((u) => u.id === load().currentUserId)
      return user ? { id: user.id, email: user.email, fullName: user.fullName } : null
    },

    onAuthChange(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },

    async signIn(email, password) {
      await delay(300)
      const user = MOCK_USERS.find((u) => u.email === email.trim().toLowerCase() && u.password === password)
      if (!user) throw new Error('Invalid login credentials')
      save({ ...load(), currentUserId: user.id })
      notify()
    },

    async signOut() {
      save({ ...load(), currentUserId: null })
      notify()
    },

    async getDocuments() {
      await delay(200)
      const clientId = requireUser()
      const { purchases } = load()
      const now = Date.now()

      return MOCK_DOCUMENTS.map((doc): PortalDocument => {
        const p = purchases[`${clientId}:${doc.id}`]
        // Simulates the webhook arriving a few seconds after checkout
        const paid = p && p.completesAt <= now
        const paidAt = paid ? new Date(p.completesAt).toISOString() : null
        return {
          ...doc,
          access: paid ? { grantedAt: paidAt! } : null,
          purchase: paid
            ? { id: `pur_${p.sessionId}`, stripeSessionId: p.sessionId, amountCents: doc.priceCents, currency: doc.currency, paidAt: paidAt!, refundedAt: null }
            : null,
          crmSync: paid
            ? config.mockZohoFails
              ? { status: 'pending', attempts: 1, lastError: 'Zoho API unavailable (simulated)', syncedAt: null }
              : { status: 'synced', attempts: 1, lastError: null, syncedAt: paidAt }
            : null,
        }
      })
    },

    async startCheckout(documentId) {
      await delay(400)
      const clientId = requireUser()
      const state = load()
      const key = `${clientId}:${documentId}`
      const sessionId = state.purchases[key]?.sessionId ?? `cs_test_mock_${Math.random().toString(36).slice(2, 12)}`
      state.purchases[key] ??= { sessionId, completesAt: Date.now() + WEBHOOK_DELAY_MS }
      save(state)
      // Real flow redirects to Stripe, which then returns to this same URL
      return `/payment/success?session_id=${sessionId}&document_id=${encodeURIComponent(documentId)}`
    },

    async getDocumentUrl(documentId) {
      const docs = await this.getDocuments()
      const doc = docs.find((d) => d.id === documentId)
      if (!doc?.access) throw new Error('You do not have access to this document')
      const text = `${doc.title}\n\nThis is mock document content. In the real app this is a signed Supabase Storage URL.`
      return URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    },
  }
}
