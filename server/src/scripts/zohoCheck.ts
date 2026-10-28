// Verifies the Zoho connection without changing anything: token works, the
// Deal fields exist, and each seeded client has an Account id.
// Usage: npm run zoho:check
import { SEED_CLIENTS } from '../../seed/seed-data.js'
import { getDealFields, ZOHO_FIELDS } from '../lib/zoho.js'

const fields = await getDealFields()
console.log('✓ Zoho token and API access work')

let ok = true
for (const name of Object.values(ZOHO_FIELDS)) {
  const found = fields.some((f) => f.api_name === name)
  ok &&= found
  console.log(`${found ? '✓' : '✗'} Deal field ${name}${found ? '' : ' is missing; create it in Zoho (Setup → Modules → Deals)'}`)
}

// Upsert only finds an existing Deal by a unique field; without it a retry could create a duplicate
const sessionField = fields.find((f) => f.api_name === ZOHO_FIELDS.stripeSessionId)
const unique = Object.keys(sessionField?.unique ?? {}).length > 0
ok &&= unique
console.log(
  unique
    ? `✓ Deal field ${ZOHO_FIELDS.stripeSessionId} is unique`
    : `✗ Deal field ${ZOHO_FIELDS.stripeSessionId} must be unique: edit it in Zoho and tick "Do not allow duplicate values"`,
)

// The token's scope covers Deals only, so Accounts are checked for format here;
// a wrong Account id makes Deal creation fail permanently with INVALID_DATA.
for (const c of SEED_CLIENTS) {
  const valid = /^\d+$/.test(c.zohoAccountId)
  ok &&= valid
  console.log(`${valid ? '✓' : '✗'} ${c.email} → Zoho account ${c.zohoAccountId}`)
}
process.exit(ok ? 0 : 1)
