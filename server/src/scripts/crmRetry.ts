// Retries Zoho CRM updates that are pending or failed.
// Usage: npm run crm:retry               (all unsynced)
//        npm run crm:retry -- <crm_sync id> [...]
import { retryCrmSyncs } from '../services/crmSync.js'

const ids = process.argv.slice(2)
const results = await retryCrmSyncs(ids.length ? ids : undefined)
if (results.length === 0) console.log('Nothing to retry: all CRM updates are synced.')
for (const r of results) console.log(`${r.id}: ${r.outcome}`)
process.exit(results.every((r) => r.outcome === 'synced' || r.outcome === 'skipped') ? 0 : 1)
