import { zohoConfig } from '../config.js'

// Deal fields written on payment. Custom field API names are created in
// Zoho (Setup → Modules → Deals) and verified by `npm run zoho:check`.
export const ZOHO_FIELDS = {
  dealName: 'Deal_Name',
  account: 'Account_Name',
  amount: 'Amount',
  stage: 'Stage',
  closingDate: 'Closing_Date',
  paymentStatus: 'Payment_Status',
  stripeSessionId: 'Stripe_Session_ID',
} as const

export const PAID_STAGE = 'Closed Won'

const REQUEST_TIMEOUT_MS = 10_000

// permanent = retrying the same request will not help (bad deal id, invalid
// data); transient = Zoho down, timeout, rate limit, token problems.
export class ZohoError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message)
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null
let refreshing: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const cfg = zohoConfig()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.ZOHO_REFRESH_TOKEN,
    client_id: cfg.ZOHO_CLIENT_ID,
    client_secret: cfg.ZOHO_CLIENT_SECRET,
  })
  let res: Response
  try {
    res = await fetch(`${cfg.ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    throw new ZohoError(`Zoho token request failed: ${(e as Error).name}`, false)
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !json.access_token) {
    // Only Zoho's error code is kept; the response never contains our secrets
    throw new ZohoError(`Zoho token refresh failed: ${json.error ?? `HTTP ${res.status}`}`, false)
  }
  // Refresh a minute early so a token never expires mid-request
  cachedToken = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 }
  return cachedToken.value
}

async function accessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  // Single-flight: concurrent callers share one refresh (Zoho rate-limits token requests)
  refreshing ??= refreshAccessToken().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function zohoFetch(path: string, init: RequestInit = {}, isRetry = false): Promise<{ status: number; json: any }> {
  const cfg = zohoConfig()
  let res: Response
  try {
    res = await fetch(`${cfg.ZOHO_API_URL}/crm/${cfg.ZOHO_API_VERSION}${path}`, {
      ...init,
      headers: {
        Authorization: `Zoho-oauthtoken ${await accessToken(isRetry)}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    if (e instanceof ZohoError) throw e
    throw new ZohoError(`Zoho unreachable: ${(e as Error).name}`, false)
  }

  // Expired or revoked access token: refresh once and try again
  if (res.status === 401 && !isRetry) return zohoFetch(path, init, true)

  const json = res.status === 204 ? null : await res.json().catch(() => null)
  if (res.status === 429) throw new ZohoError('Zoho rate limit reached (HTTP 429)', false)
  if (res.status >= 500) throw new ZohoError(`Zoho server error (HTTP ${res.status})`, false)
  if (res.status === 401) throw new ZohoError('Zoho rejected the access token (HTTP 401)', false)
  return { status: res.status, json }
}

export interface PaidDeal {
  accountId: string
  dealName: string
  amount: number // major units, e.g. 49 for $49.00
  paidAt: string
  stripeSessionId: string
}

// Creates one Closed Won Deal for one purchase, under the client's Account.
// Upsert keyed on Stripe_Session_ID (a unique field in Zoho): a retry after a
// crash (Deal created, id not yet saved) returns the same Deal, never a second.
export async function createPaidDeal(deal: PaidDeal): Promise<string> {
  if (zohoConfig().ZOHO_SIMULATE_FAILURE) {
    throw new ZohoError('Zoho unavailable (simulated via ZOHO_SIMULATE_FAILURE)', false)
  }
  if (!/^\d+$/.test(deal.accountId)) throw new ZohoError(`Invalid Zoho account id "${deal.accountId}"`, true)

  const { status, json } = await zohoFetch('/Deals/upsert', {
    method: 'POST',
    body: JSON.stringify({
      data: [
        {
          [ZOHO_FIELDS.dealName]: deal.dealName,
          [ZOHO_FIELDS.account]: { id: deal.accountId },
          [ZOHO_FIELDS.amount]: deal.amount,
          [ZOHO_FIELDS.stage]: PAID_STAGE,
          [ZOHO_FIELDS.closingDate]: deal.paidAt.slice(0, 10),
          [ZOHO_FIELDS.paymentStatus]: 'Paid',
          [ZOHO_FIELDS.stripeSessionId]: deal.stripeSessionId,
        },
      ],
      duplicate_check_fields: [ZOHO_FIELDS.stripeSessionId],
    }),
  })

  // Zoho reports per-record results inside data[], sometimes with a 2xx status
  const record = json?.data?.[0]
  if (status >= 200 && status < 300 && record?.status === 'success') return record.details.id

  const code = record?.code ?? json?.code ?? `HTTP ${status}`
  const message = record?.message ?? json?.message ?? 'unexpected response'
  throw new ZohoError(`Zoho rejected deal creation: ${code} – ${message}`, true)
}

// Demo/test helper: removes Deals created by test purchases
export async function deleteDeals(dealIds: string[]): Promise<void> {
  if (!dealIds.length) return
  const { status, json } = await zohoFetch(`/Deals?ids=${dealIds.join(',')}`, { method: 'DELETE' })
  const failed = (json?.data ?? []).filter((r: { status: string }) => r.status !== 'success')
  if (status >= 300 || failed.length) {
    throw new ZohoError(`Zoho deal delete failed: ${failed[0]?.code ?? json?.code ?? `HTTP ${status}`}`, true)
  }
}

export async function getDealFields(): Promise<{ api_name: string; unique?: object }[]> {
  const { status, json } = await zohoFetch('/settings/fields?module=Deals')
  if (status !== 200) throw new ZohoError(`Could not read Deal fields (HTTP ${status}: ${json?.code ?? ''})`, true)
  return json?.fields ?? []
}
