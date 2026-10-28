// Resets the TEST environment to "nobody has paid": clears purchases,
// entitlements, CRM jobs and processed Stripe events, and deletes the Zoho
// Deals those purchases created. Clients, documents, Accounts and logins stay.
// Usage: npm run demo:reset            (dry run: shows what would change)
//        npm run demo:reset -- --yes   (apply)
import { db } from '../lib/supabase.js'
import { deleteDeals } from '../lib/zoho.js'

const apply = process.argv.includes('--yes')

// Read the created Deal ids before crm_sync is cleared
const { data: synced, error: syncErr } = await db().from('crm_sync').select('zoho_deal_id').not('zoho_deal_id', 'is', null)
if (syncErr) throw syncErr
const dealIds = (synced ?? []).map((r) => r.zoho_deal_id as string)
console.log(`Zoho deals created by test purchases: ${dealIds.length}${apply ? ' → deleting' : ''}`)
if (apply) await deleteDeals(dealIds)

const tables = ['crm_sync', 'entitlements', 'purchases', 'stripe_events'] as const

for (const table of tables) {
  const { count, error } = await db().from(table).select('*', { count: 'exact', head: true })
  if (error) throw error
  console.log(`${table}: ${count} row(s)${apply ? ' → deleting' : ''}`)
  if (apply) {
    // Delete in child → parent order; the filter matches every row
    const key = table === 'stripe_events' ? 'event_id' : 'id'
    const { error: delErr } = await db().from(table).delete().not(key, 'is', null)
    if (delErr) throw delErr
  }
}

console.log(apply ? 'Reset complete.' : 'Dry run only. Re-run with -- --yes to apply.')
process.exit(0)
