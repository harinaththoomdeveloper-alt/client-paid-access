import { appConfig } from '../config.js'
import { errorMessage, log } from '../lib/logger.js'
import { db } from '../lib/supabase.js'
import { createPaidDeal, ZohoError } from '../lib/zoho.js'

export type SyncOutcome = 'synced' | 'pending' | 'failed' | 'skipped'

interface CrmSyncRow {
  id: string
  purchase_id: string
  zoho_account_id: string
  attempts: number
}

// 1, 2, 4, 8 … minutes, capped at 1 hour
const backoffMs = (attempts: number) => Math.min(2 ** Math.max(attempts - 1, 0), 60) * 60_000

// Creates the Zoho Deal for one purchase. Safe to call concurrently and
// repeatedly: claim_crm_sync lets only one caller through, synced jobs are
// never claimed again, and createPaidDeal reuses a Deal already created for
// the same checkout session.
export async function processCrmSync(id: string): Promise<SyncOutcome> {
  const { data: claimed, error } = await db().rpc('claim_crm_sync', { p_id: id })
  if (error) throw new Error(`claim_crm_sync failed: ${error.message}`)
  const job = (claimed as CrmSyncRow[])[0]
  if (!job) return 'skipped' // already synced, or another worker holds the lock

  try {
    const { data: purchase, error: pErr } = await db()
      .from('purchases')
      .select('stripe_session_id, paid_at, amount_cents, clients(full_name), documents(title)')
      .eq('id', job.purchase_id)
      .single<{
        stripe_session_id: string
        paid_at: string
        amount_cents: number
        clients: { full_name: string } | null
        documents: { title: string } | null
      }>()
    if (pErr || !purchase) throw new Error(`purchase ${job.purchase_id} not found`)

    const dealId = await createPaidDeal({
      accountId: job.zoho_account_id,
      dealName: `${purchase.clients?.full_name ?? 'Client'} - ${purchase.documents?.title ?? 'Document'}`,
      amount: purchase.amount_cents / 100,
      paidAt: purchase.paid_at,
      stripeSessionId: purchase.stripe_session_id,
    })

    await update(job.id, { status: 'synced', zoho_deal_id: dealId, synced_at: new Date().toISOString(), last_error: null })
    log.info('crm sync succeeded', { crmSyncId: job.id, accountId: job.zoho_account_id, dealId, attempt: job.attempts })
    return 'synced'
  } catch (e) {
    const permanent = e instanceof ZohoError && e.permanent
    const exhausted = job.attempts >= appConfig().CRM_SYNC_MAX_ATTEMPTS
    const status = permanent || exhausted ? 'failed' : 'pending'
    await update(job.id, {
      status,
      last_error: errorMessage(e).slice(0, 500),
      next_attempt_at: new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
    })
    log.warn('crm sync failed', { crmSyncId: job.id, accountId: job.zoho_account_id, attempt: job.attempts, status, error: errorMessage(e) })
    return status
  }
}

async function update(id: string, fields: Record<string, unknown>) {
  const { error } = await db()
    .from('crm_sync')
    .update({ ...fields, locked_until: null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`crm_sync update failed: ${error.message}`)
}

// Background worker: picks up pending jobs whose backoff has elapsed,
// including jobs left behind if the server crashed mid-sync.
export async function processDueCrmSyncs(limit = 20) {
  const { data, error } = await db()
    .from('crm_sync')
    .select('id')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at')
    .limit(limit)
  if (error) throw new Error(`loading due crm jobs failed: ${error.message}`)
  for (const row of data ?? []) await processCrmSync(row.id)
}

// Manual retry (CLI or admin endpoint): retries the given jobs, or every job
// that is not yet synced, immediately and regardless of backoff.
export async function retryCrmSyncs(ids?: string[]) {
  let query = db().from('crm_sync').select('id').neq('status', 'synced')
  if (ids?.length) query = query.in('id', ids)
  const { data, error } = await query
  if (error) throw new Error(`loading crm jobs failed: ${error.message}`)

  const results: { id: string; outcome: SyncOutcome }[] = []
  for (const { id } of data ?? []) {
    // Re-open failed jobs, but never touch one another worker is processing
    const now = new Date().toISOString()
    const { error: resetErr } = await db()
      .from('crm_sync')
      .update({ status: 'pending', next_attempt_at: now, updated_at: now })
      .eq('id', id)
      .neq('status', 'synced')
      .or(`locked_until.is.null,locked_until.lt.${now}`)
    if (resetErr) throw new Error(`crm_sync reset failed: ${resetErr.message}`)
    results.push({ id, outcome: await processCrmSync(id) })
  }
  return results
}
