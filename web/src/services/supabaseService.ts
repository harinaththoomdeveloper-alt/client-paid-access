import { createClient } from '@supabase/supabase-js'
import { config } from '../config'
import type { CrmSync, PortalDocument, PortalService } from '../types'

// The browser only ever holds the public anon key. Row Level Security in
// Supabase guarantees each client can read only their own rows.
// Stripe and Zoho are reached exclusively through our backend API.
export function createSupabaseService(): PortalService {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (or set VITE_USE_MOCK=true)')
  }
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

  async function accessToken(): Promise<string> {
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new Error('Not signed in')
    return data.session.access_token
  }

  async function callApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await accessToken()}`,
        ...init.headers,
      },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
    return body as T
  }

  return {
    async getCurrentClient() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data, error } = await supabase
        .from('clients')
        .select('id, email, full_name')
        .eq('id', user.id)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('No client profile is linked to this login')
      return { id: data.id, email: data.email, fullName: data.full_name }
    },

    onAuthChange(callback) {
      const { data } = supabase.auth.onAuthStateChange(() => callback())
      return () => data.subscription.unsubscribe()
    },

    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },

    async signOut() {
      await supabase.auth.signOut()
    },

    async getDocuments() {
      const [docs, entitlements, purchases] = await Promise.all([
        supabase.from('documents').select('id, title, description, price_cents, currency').order('title'),
        supabase.from('entitlements').select('document_id, purchase_id, granted_at'),
        supabase
          .from('purchases')
          .select('id, document_id, stripe_session_id, amount_cents, currency, paid_at, refunded_at, crm_sync(status, attempts, last_error, synced_at)'),
      ])
      for (const r of [docs, entitlements, purchases]) if (r.error) throw r.error

      return (docs.data ?? []).map((d): PortalDocument => {
        const ent = entitlements.data?.find((e) => e.document_id === d.id)
        // Prefer the purchase that granted access; otherwise the most recent one (e.g. refunded)
        const docPurchases = (purchases.data ?? []).filter((p) => p.document_id === d.id)
        const pur =
          docPurchases.find((p) => p.id === ent?.purchase_id) ??
          docPurchases.sort((a, b) => b.paid_at.localeCompare(a.paid_at))[0]
        // PostgREST returns a one-to-one embed as an object, but be tolerant of an array
        const sync = pur ? (Array.isArray(pur.crm_sync) ? pur.crm_sync[0] : pur.crm_sync) : null
        return {
          id: d.id,
          title: d.title,
          description: d.description,
          priceCents: d.price_cents,
          currency: d.currency,
          access: ent ? { grantedAt: ent.granted_at } : null,
          purchase: pur
            ? {
                id: pur.id,
                stripeSessionId: pur.stripe_session_id,
                amountCents: pur.amount_cents,
                currency: pur.currency,
                paidAt: pur.paid_at,
                refundedAt: pur.refunded_at,
              }
            : null,
          crmSync: sync
            ? {
                status: sync.status as CrmSync['status'],
                attempts: sync.attempts,
                lastError: sync.last_error,
                syncedAt: sync.synced_at,
              }
            : null,
        }
      })
    },

    async startCheckout(documentId) {
      const { url } = await callApi<{ url: string }>('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({ documentId }),
      })
      return url
    },

    async getDocumentUrl(documentId) {
      const { url } = await callApi<{ url: string }>(`/api/documents/${encodeURIComponent(documentId)}/url`)
      return url
    },
  }
}
