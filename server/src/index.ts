import { createApp } from './app.js'
import { appConfig, stripeConfig, supabaseConfig, zohoConfig } from './config.js'
import { errorMessage, log } from './lib/logger.js'
import { processDueCrmSyncs } from './services/crmSync.js'

// Fail fast on missing or invalid configuration
const { PORT, CRM_SYNC_INTERVAL_SECONDS } = appConfig()
supabaseConfig()
stripeConfig()
const { ZOHO_SIMULATE_FAILURE } = zohoConfig()

createApp().listen(PORT, () => {
  log.info('server started', { port: PORT, zohoSimulateFailure: ZOHO_SIMULATE_FAILURE })
})

// Background retry of pending Zoho updates (never overlaps with itself)
let running = false
setInterval(async () => {
  if (running) return
  running = true
  try {
    await processDueCrmSyncs()
  } catch (e) {
    log.error('crm worker run failed', { error: errorMessage(e) })
  } finally {
    running = false
  }
}, CRM_SYNC_INTERVAL_SECONDS * 1000)
